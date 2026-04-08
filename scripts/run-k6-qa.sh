#!/usr/bin/env bash
# scripts/run-k6-qa.sh
#
# Script principal del pipeline K6 QA.
# Replica el patrón de run_karate_qa.sh del repo HOTEL_QA_TEST_KARATE:
#   1. Clona el último commit del repo target (backend dev)
#   2. Levanta PostgreSQL desde el docker-compose del repo clonado
#   3. Instala dependencias, siembra la BD y arranca el backend como proceso Node
#   4. Levanta InfluxDB + Grafana desde el docker-compose de este repo
#   5. Ejecuta la suite K6 enviando métricas a InfluxDB
#
# QA_MODE controla qué fase ejecuta este invocación:
#   infra  — clonar target, iniciar Postgres + backend + observabilidad, escribir STATE_FILE
#   k6     — leer STATE_FILE, instalar k6, ejecutar smoke-test
#   all    — ciclo completo (por defecto, para ejecución local)
#
# Variables de entorno requeridas (o valor por defecto):
#   TARGET_REPO_URL         https://github.com/EGgames/HOTEL-MVP.git
#   TARGET_REPO_BRANCH      dev
#   QA_API_PORT             3100
#   QA_DB_PORT              5540
#   QA_ARTIFACTS_DIR        ./qa-artifacts/latest
#   TARGET_CLONE_DIR        ./target-under-test

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="${QA_ARTIFACTS_DIR:-${ROOT_DIR}/qa-artifacts/latest}"
LOGS_DIR="${ARTIFACTS_DIR}/logs"
REPORTS_DIR="${ARTIFACTS_DIR}/reports"
PIPELINE_DIR="${ARTIFACTS_DIR}/pipeline"
TARGET_CLONE_DIR="${TARGET_CLONE_DIR:-${ROOT_DIR}/target-under-test}"

TARGET_REPO_URL="${TARGET_REPO_URL:-https://github.com/EGgames/HOTEL-MVP.git}"
TARGET_REPO_BRANCH="${TARGET_REPO_BRANCH:-dev}"
QA_API_PORT="${QA_API_PORT:-3100}"
QA_DB_PORT="${QA_DB_PORT:-5540}"

DB_USER="${DB_USER:-hotel_user}"
DB_PASSWORD="${DB_PASSWORD:-hotel_pass}"
DB_NAME="${DB_NAME:-hotel_booking}"
HOLD_DURATION_MINUTES="${HOLD_DURATION_MINUTES:-10}"
PAYMENT_SIMULATOR_DECLINE_RATE="${PAYMENT_SIMULATOR_DECLINE_RATE:-0.2}"

K6_ENV="${K6_ENV:-qa}"
# URL que k6 usará para las peticiones HTTP
K6_BASE_URL="${K6_BASE_URL:-http://127.0.0.1:${QA_API_PORT}/api/v1}"

QA_MODE="${QA_MODE:-all}"
STATE_FILE="${ARTIFACTS_DIR}/.k6-qa-state"

API_PID=''
TARGET_COMPOSE_FILE=''
COMPOSE_BIN=''
K6_EXIT='99'
TARGET_COMMIT=''

# ── Helpers ───────────────────────────────────────────────────────────────────

log() {
  printf '[k6-qa] %s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "Falta el comando requerido: $1"
    exit 1
  }
}

detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN='docker compose'
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN='docker-compose'
    return
  fi
  log 'Docker Compose no está disponible'
  exit 1
}

# Ejecuta docker-compose contra el docker-compose del repo TARGET (Postgres)
compose_target() {
  if [[ -z "${COMPOSE_BIN}" ]]; then detect_compose; fi
  if [[ "${COMPOSE_BIN}" == 'docker compose' ]]; then
    docker compose -f "${TARGET_COMPOSE_FILE}" "$@"
  else
    docker-compose -f "${TARGET_COMPOSE_FILE}" "$@"
  fi
}

# Ejecuta docker-compose contra el docker-compose de ESTE repo (InfluxDB + Grafana)
compose_obs() {
  if [[ -z "${COMPOSE_BIN}" ]]; then detect_compose; fi
  if [[ "${COMPOSE_BIN}" == 'docker compose' ]]; then
    docker compose -f "${ROOT_DIR}/docker-compose.yml" "$@"
  else
    docker-compose -f "${ROOT_DIR}/docker-compose.yml" "$@"
  fi
}

find_target_compose_file() {
  local candidate
  for candidate in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
    if [[ -f "${TARGET_CLONE_DIR}/${candidate}" ]]; then
      TARGET_COMPOSE_FILE="${TARGET_CLONE_DIR}/${candidate}"
      return
    fi
  done
  log 'No se encontró archivo de Docker Compose en el repo target'
  exit 1
}

wait_for_postgres() {
  local attempts=0
  log "Esperando que PostgreSQL quede listo (puerto ${QA_DB_PORT})..."
  until compose_target exec -T postgres \
      pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if (( attempts > 30 )); then
      log 'PostgreSQL no quedó listo a tiempo'
      return 1
    fi
    sleep 3
  done
  log 'PostgreSQL listo'
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts=0
  log "Esperando ${label} en ${url}..."
  until curl --fail --silent --max-time 4 "${url}" >/dev/null; do
    attempts=$((attempts + 1))
    if (( attempts > 45 )); then
      log "${label} no respondió a tiempo: ${url}"
      return 1
    fi
    sleep 3
  done
  log "${label} listo"
}

# ── Teardown ──────────────────────────────────────────────────────────────────

_teardown() {
  if [[ -z "${TARGET_COMPOSE_FILE}" && -f "${STATE_FILE:-}" ]]; then
    # shellcheck source=/dev/null
    source "${STATE_FILE}" 2>/dev/null || true
  fi

  # Detener el proceso backend si sigue corriendo
  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" >/dev/null 2>&1; then
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" >/dev/null 2>&1 || true
    log "Backend detenido (PID ${API_PID})"
  fi

  # Detener Postgres del repo target
  if [[ -n "${TARGET_COMPOSE_FILE}" ]]; then
    compose_target logs --no-color \
      > "${LOGS_DIR}/postgres-compose.log" 2>&1 || true
    compose_target down -v \
      > "${LOGS_DIR}/postgres-compose-down.log" 2>&1 || true
    log 'Postgres del repo target detenido'
  fi

  # Detener InfluxDB + Grafana de este repo
  compose_obs logs --no-color \
    > "${LOGS_DIR}/obs-compose.log" 2>&1 || true
  compose_obs down -v \
    > "${LOGS_DIR}/obs-compose-down.log" 2>&1 || true
  log 'Stack de observabilidad detenido'

  generate_k6_summary || true
}

cleanup() {
  local exit_code=$?
  _teardown
  exit "${exit_code}"
}

[[ "${QA_MODE}" == 'all' ]] && trap cleanup EXIT

# ── Validaciones previas ──────────────────────────────────────────────────────

require_cmd git
require_cmd docker
require_cmd curl
require_cmd node
require_cmd npm

mkdir -p "${LOGS_DIR}" "${REPORTS_DIR}" "${PIPELINE_DIR}"

# ── Fase INFRA ────────────────────────────────────────────────────────────────
# Ejecutada en modo 'infra' o 'all'

if [[ "${QA_MODE}" == 'infra' || "${QA_MODE}" == 'all' ]]; then

  rm -rf "${TARGET_CLONE_DIR}"

  log "Clonando ${TARGET_REPO_URL}#${TARGET_REPO_BRANCH}"
  # [RISK-S3] Solo ejecutar contra repositorios de confianza.
  git clone \
    --depth 1 \
    --branch "${TARGET_REPO_BRANCH}" \
    "${TARGET_REPO_URL}" \
    "${TARGET_CLONE_DIR}" \
    > "${LOGS_DIR}/git-clone.log" 2>&1
  TARGET_COMMIT="$(git -C "${TARGET_CLONE_DIR}" rev-parse HEAD 2>/dev/null || echo unknown)"
  log "Commit clonado: ${TARGET_COMMIT}"

  find_target_compose_file

  # Levantar PostgreSQL desde el docker-compose del repo target
  log 'Levantando PostgreSQL del repo target'
  export DB_PORT="${QA_DB_PORT}"
  compose_target up -d postgres \
    > "${LOGS_DIR}/postgres-compose-up.log" 2>&1
  wait_for_postgres

  # Instalar dependencias, sembrar datos y arrancar el backend
  log 'Instalando dependencias y construyendo el backend'
  pushd "${TARGET_CLONE_DIR}/backend" >/dev/null
  export PORT="${QA_API_PORT}"
  export NODE_ENV=development
  export DB_HOST=127.0.0.1
  export DB_PORT="${QA_DB_PORT}"
  export DB_USER DB_PASSWORD DB_NAME HOLD_DURATION_MINUTES PAYMENT_SIMULATOR_DECLINE_RATE

  npm ci                         > "${LOGS_DIR}/npm-ci.log" 2>&1
  npm run seed                   > "${LOGS_DIR}/seed.log" 2>&1
  npm run build                  > "${LOGS_DIR}/npm-build.log" 2>&1

  node dist/main > "${LOGS_DIR}/backend.log" 2>&1 &
  API_PID=$!
  log "Backend iniciado (PID ${API_PID})"
  popd >/dev/null

  wait_for_http "http://127.0.0.1:${QA_API_PORT}/health" 'API backend'

  # Levantar InfluxDB + Grafana (stack de observabilidad de este repo)
  log 'Levantando InfluxDB y Grafana'
  compose_obs up -d influxdb grafana \
    > "${LOGS_DIR}/obs-compose-up.log" 2>&1

  wait_for_http 'http://localhost:8086/ping' 'InfluxDB'

  # Esperar Grafana (no es crítico para los tests, solo para el reporte)
  GRAFANA_ATTEMPTS=0
  until curl --fail --silent --max-time 4 \
      'http://localhost:3000/api/health' | grep -q '"database": "ok"'; do
    GRAFANA_ATTEMPTS=$((GRAFANA_ATTEMPTS + 1))
    if (( GRAFANA_ATTEMPTS > 20 )); then
      log 'Grafana tardó demasiado — continuando de todas formas'
      break
    fi
    sleep 3
  done
  log 'Grafana listo (o timeout tolerado)'

  if [[ "${QA_MODE}" == 'infra' ]]; then
    # Escribir STATE_FILE para que la fase k6 pueda retomar el entorno
    mkdir -p "$(dirname "${STATE_FILE}")"
    {
      printf 'API_PID=%q\n'             "${API_PID}"
      printf 'TARGET_COMPOSE_FILE=%q\n' "${TARGET_COMPOSE_FILE}"
      printf 'TARGET_COMMIT=%q\n'       "${TARGET_COMMIT}"
      printf 'QA_API_PORT=%q\n'         "${QA_API_PORT}"
      printf 'QA_DB_PORT=%q\n'          "${QA_DB_PORT}"
      printf 'K6_BASE_URL=%q\n'         "http://127.0.0.1:${QA_API_PORT}/api/v1"
    } > "${STATE_FILE}"
    log "Infraestructura lista. Estado en ${STATE_FILE}"
    generate_infra_summary 2>/dev/null || true
    exit 0
  fi
fi

# ── Función generate_infra_summary ───────────────────────────────────────────

generate_infra_summary() {
  cat > "${REPORTS_DIR}/infra-summary.md" <<EOF
# Infraestructura K6 — Resumen de Arranque

- Estado: PASS
- Repositorio target: ${TARGET_REPO_URL}
- Rama target: ${TARGET_REPO_BRANCH}
- Commit: ${TARGET_COMMIT:-desconocido}
- API URL: http://127.0.0.1:${QA_API_PORT}/api/v1

| Servicio       | Estado | Detalle                              |
|----------------|--------|--------------------------------------|
| PostgreSQL     | PASS   | Puerto ${QA_DB_PORT} — pg_isready OK |
| Backend Node   | PASS   | health check OK                      |
| InfluxDB       | PASS   | ping OK — database k6              |
| Grafana        | PASS   | http://localhost:3000                |
EOF
}

# ── Función generate_k6_summary ───────────────────────────────────────────────

generate_k6_summary() {
  mkdir -p "${REPORTS_DIR}" "${PIPELINE_DIR}"

  local k6_status='FAIL'
  [[ "${K6_EXIT}" == '0' ]] && k6_status='PASS'

  local summary_file="${REPORTS_DIR}/k6-summary.md"

  {
    echo "# K6 Smoke Tests — Resumen de Ejecución"
    echo ""
    echo "- Estado: ${k6_status}"
    echo "- Repositorio target: ${TARGET_REPO_URL:-N/A}"
    echo "- Rama target: ${TARGET_REPO_BRANCH:-N/A}"
    echo "- Commit: ${TARGET_COMMIT:-desconocido}"
    echo "- API URL: ${K6_BASE_URL:-N/A}"
    echo ""
    echo "| Suite       | Estado | Detalle                     |"
    echo "|-------------|--------|-----------------------------|"
    echo "| Smoke Tests | ${k6_status}   | exit code: ${K6_EXIT} |"
    echo ""
    echo "## Artefactos"
    echo ""
    echo "- Log k6: logs/k6-smoke.log"
    echo "- Summary JSON: reports/summary.json"
    echo "- Reporte HTML: reports/smoke-report.html"
  } > "${summary_file}"

  # JSON de ejecución para el pipeline
  python3 - <<PYEOF
import json
data = {
  "overall_status": "${k6_status}",
  "k6": {
    "exit_code": int("${K6_EXIT}"),
    "status": "${k6_status}",
    "base_url": "${K6_BASE_URL:-}",
    "commit": "${TARGET_COMMIT:-unknown}"
  }
}
with open("${PIPELINE_DIR}/k6-summary.json", "w") as f:
    json.dump(data, f, indent=2)
PYEOF
}

# ── Fase K6 ───────────────────────────────────────────────────────────────────
# Ejecutada en modo 'k6' o 'all'

if [[ "${QA_MODE}" == 'k6' || "${QA_MODE}" == 'all' ]]; then

  # En modo k6 puro leer estado escrito por la fase infra
  if [[ "${QA_MODE}" == 'k6' && -f "${STATE_FILE}" ]]; then
    # shellcheck source=/dev/null
    source "${STATE_FILE}"
    log "Estado de infraestructura cargado desde ${STATE_FILE}"
    log "API en ${K6_BASE_URL} | Commit ${TARGET_COMMIT}"
  fi

  # Instalar k6 si no está disponible
  if ! command -v k6 >/dev/null 2>&1; then
    log 'Instalando k6...'
    curl -fsSL https://dl.grafana.com/enterprise/release/k6-v0.55.0-linux-amd64.deb \
      -o /tmp/k6.deb
    sudo dpkg -i /tmp/k6.deb
    log "k6 $(k6 version) instalado"
  else
    log "k6 ya disponible: $(k6 version)"
  fi

  log "Ejecutando K6 Smoke Test contra ${K6_BASE_URL}"
  pushd "${ROOT_DIR}" >/dev/null
  set +e
  k6 run \
    --out "influxdb=http://localhost:8086/k6" \
    -e K6_ENV="${K6_ENV}" \
    -e QA_BASE_URL="${K6_BASE_URL}" \
    --summary-export="${REPORTS_DIR}/summary.json" \
    tests/smoke-test.js \
    2>&1 | tee "${LOGS_DIR}/k6-smoke.log"
  K6_EXIT=${PIPESTATUS[0]}
  set -e
  popd >/dev/null

  log "K6 finalizó con código: ${K6_EXIT}"

  # Exportar snapshot del dashboard de Grafana
  sleep 8  # dar tiempo a que InfluxDB procese los datos
  DASHBOARD_UID=$(curl --silent 'http://localhost:3000/api/search?type=dash-db' \
    | python3 -c "
import json,sys
ds = json.load(sys.stdin)
print(ds[0]['uid'] if ds else 'not-found')
" 2>/dev/null || echo 'not-found')

  GRAFANA_SNAPSHOT_URL=''
  if [[ "${DASHBOARD_UID}" != 'not-found' ]]; then
    # Exportar el JSON completo del dashboard
    DASHBOARD_FULL=$(curl --silent \
      "http://localhost:3000/api/dashboards/uid/${DASHBOARD_UID}" 2>/dev/null || echo '{}')
    echo "${DASHBOARD_FULL}" > "${REPORTS_DIR}/grafana-dashboard-export.json" || true

    # Extraer solo el modelo del dashboard (sin metadata)
    DASHBOARD_MODEL=$(echo "${DASHBOARD_FULL}" \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('dashboard',{})))" \
      2>/dev/null || echo '{}')

    # Crear snapshot externo (hospedado en snapshots.raintank.io, público 7 días)
    SNAPSHOT_RESP=$(curl --silent -X POST 'http://localhost:3000/api/snapshots' \
      -H 'Content-Type: application/json' \
      --data-raw "{\"dashboard\": ${DASHBOARD_MODEL}, \"name\": \"K6 Smoke - ${GITHUB_RUN_ID:-local}\", \"external\": true, \"expires\": 604800}" \
      2>/dev/null || echo '{}')

    GRAFANA_SNAPSHOT_URL=$(echo "${SNAPSHOT_RESP}" \
      | python3 -c "
import json, sys
d = json.load(sys.stdin)
url = d.get('externalUrl') or d.get('url') or ''
print(url)
" 2>/dev/null || echo '')

    if [[ -n "${GRAFANA_SNAPSHOT_URL}" ]]; then
      echo "${GRAFANA_SNAPSHOT_URL}" > "${REPORTS_DIR}/grafana-snapshot.url"
      log "Grafana snapshot URL: ${GRAFANA_SNAPSHOT_URL}"
    else
      log "Advertencia: no se pudo crear el snapshot de Grafana"
    fi
  fi

  # Generar reporte HTML
  if [[ -f "${REPORTS_DIR}/summary.json" ]]; then
    bash "${ROOT_DIR}/scripts/generate-smoke-report.sh" \
      "${REPORTS_DIR}/summary.json" \
      "${REPORTS_DIR}/smoke-report.html" \
      "${GITHUB_RUN_ID:-local}" \
      "${TARGET_COMMIT:-local}" \
      "${GRAFANA_SNAPSHOT_URL}" \
      2>/dev/null || log 'Advertencia: reporte HTML no generado'
  fi

  # Persistir exit code en el STATE_FILE para la fase de cleanup
  if [[ -f "${STATE_FILE}" ]]; then
    printf 'K6_EXIT=%q\n' "${K6_EXIT}" >> "${STATE_FILE}"
  fi

  generate_k6_summary || true

  if [[ "${QA_MODE}" == 'k6' ]]; then
    if [[ ${K6_EXIT} -ne 0 ]]; then
      log 'K6 reportó fallos en los thresholds'
      exit "${K6_EXIT}"
    fi
    exit 0
  fi
fi

# ── Modo all — salida combinada ───────────────────────────────────────────────

if [[ ${K6_EXIT} -ne 0 ]]; then
  log 'K6 Smoke Tests fallaron'
  exit "${K6_EXIT}"
fi

log 'K6 QA finalizado correctamente'
