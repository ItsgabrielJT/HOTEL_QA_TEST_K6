#!/usr/bin/env bash
# scripts/generate-smoke-report.sh
# Genera un reporte HTML profesional a partir del summary.json de k6.
#
# Uso:
#   bash scripts/generate-smoke-report.sh \
#     <summary_json> <output_html> <run_id> <commit_sha> [grafana_url]

set -euo pipefail

SUMMARY_JSON="${1:?Falta summary.json}"
OUTPUT_HTML="${2:?Falta ruta de salida HTML}"
RUN_ID="${3:-N/A}"
COMMIT_SHA="${4:-N/A}"
GRAFANA_URL="${5:-}"

if [[ ! -f "$SUMMARY_JSON" ]]; then
  echo "ERROR: $SUMMARY_JSON no existe" >&2
  exit 1
fi

# Extraer métricas clave con python3 (disponible en ubuntu-22.04)
METRICS_JSON=$(python3 - <<PYEOF
import json, sys

with open("$SUMMARY_JSON") as f:
    data = json.load(f)

metrics = data.get("metrics", {})

def safe(m, *path, default="N/A"):
    try:
        v = metrics
        for p in [m] + list(path):
            v = v[p]
        return v
    except (KeyError, TypeError):
        return default

def pct(m, k, default="N/A"):
    try:
        v = metrics[m]["values"][k]
        if isinstance(v, float):
            return f"{v:.2f}"
        return str(v)
    except (KeyError, TypeError):
        return default

def rate(m):
    try:
        v = metrics[m]["values"]["rate"]
        return f"{v*100:.2f}%"
    except (KeyError, TypeError):
        return "N/A"

result = {
    "http_reqs":           safe("http_reqs", "values", "count", default="N/A"),
    "http_req_duration_avg": pct("http_req_duration", "avg"),
    "http_req_duration_p90": pct("http_req_duration", "p(90)"),
    "http_req_duration_p95": pct("http_req_duration", "p(95)"),
    "http_req_duration_max": pct("http_req_duration", "max"),
    "http_req_failed":     rate("http_req_failed"),
    "checks_rate":         rate("checks"),
    "vus_max":             safe("vus_max", "values", "max", default="N/A"),
    "iterations":          safe("iterations", "values", "count", default="N/A"),
    "data_sent":           safe("data_sent", "values", "count", default="N/A"),
    "data_received":       safe("data_received", "values", "count", default="N/A"),
}
print(json.dumps(result))
PYEOF
)

# Leer métricas individuales
REQ_COUNT=$(echo "$METRICS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['http_reqs'])")
DUR_AVG=$(echo "$METRICS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['http_req_duration_avg'])")
DUR_P90=$(echo "$METRICS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['http_req_duration_p90'])")
DUR_P95=$(echo "$METRICS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['http_req_duration_p95'])")
DUR_MAX=$(echo "$METRICS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['http_req_duration_max'])")
FAILED_RATE=$(echo "$METRICS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['http_req_failed'])")
CHECKS_RATE=$(echo "$METRICS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['checks_rate'])")
VUS_MAX=$(echo "$METRICS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['vus_max'])")
ITERATIONS=$(echo "$METRICS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['iterations'])")
GENERATED_AT=$(date -u '+%Y-%m-%d %H:%M UTC')

# Determinar color de estado según http_req_failed
if echo "$FAILED_RATE" | grep -qE '^0\.00%$'; then
  STATUS_COLOR="#16a34a"
  STATUS_TEXT="PASSED"
  STATUS_ICON="✅"
else
  STATUS_COLOR="#dc2626"
  STATUS_TEXT="FAILED"
  STATUS_ICON="❌"
fi

GRAFANA_SECTION=""
if [[ -n "$GRAFANA_URL" ]]; then
  GRAFANA_SECTION="<div class=\"card\">
      <h2>Dashboard Grafana</h2>
      <p>Los datos de esta ejecución están disponibles en el snapshot de Grafana:</p>
      <a class=\"link-btn grafana-btn\" href=\"${GRAFANA_URL}\" target=\"_blank\" rel=\"noopener\">
        Ver Dashboard en Grafana
      </a>
    </div>"
fi

mkdir -p "$(dirname "$OUTPUT_HTML")"

cat > "$OUTPUT_HTML" <<HTML
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
    <title>K6 Smoke Report — Run ${RUN_ID}</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        background: #f0f4f8;
        color: #1e293b;
        min-height: 100vh;
        padding: 2rem 1rem;
      }
      .container { max-width: 900px; margin: 0 auto; }
      header {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        color: #f1f5f9;
        padding: 2.5rem;
        border-radius: 16px;
        margin-bottom: 2rem;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      }
      header .logo { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-bottom: 0.5rem; }
      header h1 { font-size: 2rem; font-weight: 800; }
      header .subtitle { color: #94a3b8; margin-top: 0.35rem; font-size: 0.9rem; }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.5rem 1.25rem;
        border-radius: 9999px;
        font-weight: 700;
        font-size: 1rem;
        background: ${STATUS_COLOR};
        color: white;
        margin-top: 1.25rem;
        letter-spacing: 0.03em;
      }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
      .metric-card {
        background: white;
        border-radius: 12px;
        padding: 1.25rem;
        border: 1px solid #e2e8f0;
        box-shadow: 0 1px 4px rgba(0,0,0,0.05);
        text-align: center;
      }
      .metric-card .value { font-size: 1.75rem; font-weight: 800; color: #0f172a; line-height: 1; }
      .metric-card .label { font-size: 0.75rem; color: #64748b; margin-top: 0.35rem; text-transform: uppercase; letter-spacing: 0.05em; }
      .card {
        background: white;
        border-radius: 12px;
        padding: 1.75rem;
        margin-bottom: 1.5rem;
        border: 1px solid #e2e8f0;
        box-shadow: 0 1px 4px rgba(0,0,0,0.05);
      }
      .card h2 { font-size: 1rem; font-weight: 700; margin-bottom: 1.25rem; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 0.65rem 0.75rem; border-bottom: 1px solid #f1f5f9; font-size: 0.9rem; vertical-align: top; }
      td:first-child { font-weight: 600; color: #64748b; width: 45%; }
      tr:last-child td { border-bottom: none; }
      code { background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.85em; font-family: "SF Mono", "Fira Code", monospace; }
      .link-btn {
        display: inline-flex;
        align-items: center;
        padding: 0.5rem 1.1rem;
        background: #3b82f6;
        color: white;
        border-radius: 6px;
        text-decoration: none;
        font-size: 0.85rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        transition: background 0.15s;
      }
      .link-btn:hover { background: #2563eb; }
      .grafana-btn { background: #f46800; }
      .grafana-btn:hover { background: #d45a00; }
      footer { text-align: center; color: #94a3b8; font-size: 0.8rem; padding-top: 1.5rem; }
      @media (max-width: 600px) { header h1 { font-size: 1.4rem; } .grid { grid-template-columns: 1fr 1fr; } }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <div class="logo">Hotel QA — K6 Performance Testing</div>
        <h1>Smoke Test Report</h1>
        <div class="subtitle">Run <code style="background:rgba(255,255,255,0.1); color: #e2e8f0;">${RUN_ID}</code> &nbsp;·&nbsp; Commit <code style="background:rgba(255,255,255,0.1); color: #e2e8f0;">${COMMIT_SHA:0:7}</code></div>
        <div class="badge">${STATUS_ICON} ${STATUS_TEXT}</div>
      </header>

      <div class="grid">
        <div class="metric-card">
          <div class="value">${REQ_COUNT}</div>
          <div class="label">Requests</div>
        </div>
        <div class="metric-card">
          <div class="value">${DUR_AVG}ms</div>
          <div class="label">Avg Duration</div>
        </div>
        <div class="metric-card">
          <div class="value">${DUR_P95}ms</div>
          <div class="label">p(95) Duration</div>
        </div>
        <div class="metric-card">
          <div class="value">${FAILED_RATE}</div>
          <div class="label">Error Rate</div>
        </div>
        <div class="metric-card">
          <div class="value">${CHECKS_RATE}</div>
          <div class="label">Checks OK</div>
        </div>
        <div class="metric-card">
          <div class="value">${VUS_MAX}</div>
          <div class="label">Max VUs</div>
        </div>
      </div>

      <div class="card">
        <h2>Métricas de Rendimiento</h2>
        <table>
          <tr><td>Requests totales</td><td>${REQ_COUNT}</td></tr>
          <tr><td>Iteraciones</td><td>${ITERATIONS}</td></tr>
          <tr><td>VUs máximos</td><td>${VUS_MAX}</td></tr>
          <tr><td>Duración promedio</td><td>${DUR_AVG} ms</td></tr>
          <tr><td>Duración p(90)</td><td>${DUR_P90} ms</td></tr>
          <tr><td>Duración p(95)</td><td>${DUR_P95} ms</td></tr>
          <tr><td>Duración máxima</td><td>${DUR_MAX} ms</td></tr>
          <tr><td>Tasa de error</td><td>${FAILED_RATE}</td></tr>
          <tr><td>Checks exitosos</td><td>${CHECKS_RATE}</td></tr>
        </table>
      </div>

      <div class="card">
        <h2>Información del Run</h2>
        <table>
          <tr><td>Run ID</td><td><code>${RUN_ID}</code></td></tr>
          <tr><td>Commit</td><td><code>${COMMIT_SHA}</code></td></tr>
          <tr><td>Generado</td><td>${GENERATED_AT}</td></tr>
          <tr><td>Estado final</td><td><strong>${STATUS_TEXT}</strong></td></tr>
        </table>
      </div>

      ${GRAFANA_SECTION}

      <div class="card">
        <h2>Artefactos</h2>
        <table>
          <tr>
            <td>Log completo k6</td>
            <td><a href="assets/k6-smoke.log" class="link-btn">Descargar log</a></td>
          </tr>
          <tr>
            <td>Dashboard Grafana (JSON)</td>
            <td><a href="assets/grafana-dashboard-export.json" class="link-btn">Descargar JSON</a></td>
          </tr>
        </table>
      </div>

      <footer>Hotel QA K6 Smoke Tests &nbsp;·&nbsp; ${GENERATED_AT}</footer>
    </div>
  </body>
</html>
HTML

echo "Reporte HTML generado en: $OUTPUT_HTML"
