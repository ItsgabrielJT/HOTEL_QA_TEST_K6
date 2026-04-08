#!/usr/bin/env bash
# scripts/generate-smoke-report.sh
#
# Genera el reporte HTML para GitHub Pages a partir del summary.json de k6.
#
# Uso:
#   bash scripts/generate-smoke-report.sh \
#     <summary.json> <output.html> <run_id> <commit_sha> [grafana_url]

set -euo pipefail

SUMMARY_JSON="${1:?Falta ruta a summary.json}"
OUTPUT_HTML="${2:?Falta ruta de salida HTML}"
RUN_ID="${3:-N/A}"
COMMIT_SHA="${4:-N/A}"
GRAFANA_URL="${5:-}"

if [[ ! -f "$SUMMARY_JSON" ]]; then
  echo "ERROR: $SUMMARY_JSON no existe" >&2
  exit 1
fi

# ── Extraer métricas ──────────────────────────────────────────────────────────
# Formato k6 --summary-export (v0.40+): valores planos bajo la clave de métrica,
# SIN capa intermedia "values". Fallback a .values.KEY para compatibilidad.
export SUMMARY_JSON_PATH="$SUMMARY_JSON"

METRICS_JSON=$(python3 - <<'PYEOF'
import json, sys, os

data = json.load(open(os.environ["SUMMARY_JSON_PATH"]))
metrics = data.get("metrics", {})

def trend(metric, key, decimals=2):
    m = metrics.get(metric, {})
    v = m.get(key)
    if v is None:
        v = m.get("values", {}).get(key)
    if v is None:
        return "N/A"
    try:
        return round(float(v), decimals)
    except (ValueError, TypeError):
        return "N/A"

def rate_pct(metric):
    m = metrics.get(metric, {})
    v = m.get("value")
    if v is None:
        v = m.get("values", {}).get("rate")
    if v is None:
        return "N/A"
    try:
        return "{:.2f}%".format(float(v) * 100)
    except (ValueError, TypeError):
        return "N/A"

def counter(metric, key="count"):
    m = metrics.get(metric, {})
    v = m.get(key)
    if v is None:
        v = m.get("values", {}).get(key)
    return int(v) if v is not None else "N/A"

def safe_float(v):
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0

dur_avg = trend("http_req_duration", "avg")
dur_p90 = trend("http_req_duration", "p(90)")
dur_p95 = trend("http_req_duration", "p(95)")
dur_max = trend("http_req_duration", "max")

checks_passes = metrics.get("checks", {}).get("passes", "N/A")
checks_fails  = metrics.get("checks", {}).get("fails", 0)
reqs          = counter("http_reqs")
iters         = counter("iterations")
vus_max_v     = (metrics.get("vus_max", {}).get("max")
                 or metrics.get("vus_max", {}).get("values", {}).get("max")
                 or "N/A")

result = {
    "http_reqs":       reqs,
    "iterations":      iters,
    "vus_max":         vus_max_v,
    "dur_avg":         dur_avg,
    "dur_p90":         dur_p90,
    "dur_p95":         dur_p95,
    "dur_max":         dur_max,
    "err_rate_str":    rate_pct("http_req_failed"),
    "checks_rate_str": rate_pct("checks"),
    "checks_passes":   checks_passes,
    "checks_fails":    checks_fails,
    "dur_avg_n":       safe_float(dur_avg),
    "dur_p90_n":       safe_float(dur_p90),
    "dur_p95_n":       safe_float(dur_p95),
    "dur_max_n":       safe_float(dur_max),
    "checks_passes_n": int(checks_passes) if isinstance(checks_passes, (int, float)) else 0,
    "checks_fails_n":  int(checks_fails)  if isinstance(checks_fails,  (int, float)) else 0,
}
print(json.dumps(result))
PYEOF
)

# ── Leer métricas en variables bash ──────────────────────────────────────────
_get() { echo "$METRICS_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1','N/A'))"; }

REQ_COUNT=$(_get http_reqs)
ITERATIONS=$(_get iterations)
VUS_MAX=$(_get vus_max)
DUR_AVG=$(_get dur_avg)
DUR_P90=$(_get dur_p90)
DUR_P95=$(_get dur_p95)
DUR_MAX=$(_get dur_max)
FAILED_RATE=$(_get err_rate_str)
CHECKS_RATE=$(_get checks_rate_str)
CHECKS_PASSES=$(_get checks_passes)
CHECKS_FAILS=$(_get checks_fails)
DUR_AVG_N=$(_get dur_avg_n)
DUR_P90_N=$(_get dur_p90_n)
DUR_P95_N=$(_get dur_p95_n)
DUR_MAX_N=$(_get dur_max_n)
CHECKS_PASSES_N=$(_get checks_passes_n)
CHECKS_FAILS_N=$(_get checks_fails_n)

GENERATED_AT=$(date -u '+%Y-%m-%d %H:%M UTC')

# ── Estado ────────────────────────────────────────────────────────────────────
if [[ "$FAILED_RATE" == "0.00%" ]]; then
  STATUS_COLOR="#16a34a"; STATUS_TEXT="PASSED"; STATUS_ICON="✅"
else
  STATUS_COLOR="#dc2626"; STATUS_TEXT="FAILED"; STATUS_ICON="❌"
fi

# ── Sección Grafana (opcional) ────────────────────────────────────────────────
GRAFANA_SECTION=""
if [[ -n "$GRAFANA_URL" ]]; then
  GRAFANA_SECTION="
      <div class=\"card\">
        <h2>Dashboard Grafana</h2>
        <p style=\"margin-bottom:1rem;color:#475569;font-size:0.9rem;\">
          Dashboard de esta ejecución como snapshot público de Grafana (disponible 7 días).
        </p>
        <a class=\"link-btn grafana-btn\" href=\"${GRAFANA_URL}\" target=\"_blank\" rel=\"noopener noreferrer\">
          Ver Dashboard en Grafana ↗
        </a>
        <div style=\"margin-top:1.5rem;\">
          <iframe src=\"${GRAFANA_URL}&kiosk=tv\" width=\"100%\" height=\"580\"
            frameborder=\"0\" style=\"border-radius:8px;border:1px solid #e2e8f0;\"
            title=\"Grafana Dashboard Snapshot\"></iframe>
        </div>
      </div>"
fi

mkdir -p "$(dirname "$OUTPUT_HTML")"

# ── Generar HTML ──────────────────────────────────────────────────────────────
# Nota: heredoc sin 'comillas' → bash expande ${VAR}.
# El JS usa notación de objeto normal (sin template literals) para evitar conflictos.
cat > "$OUTPUT_HTML" << HTML
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <title>K6 Smoke Report — Run ${RUN_ID}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: #f0f4f8; color: #1e293b; min-height: 100vh; padding: 2rem 1rem;
    }
    .container { max-width: 960px; margin: 0 auto; }
    header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      color: #f1f5f9; padding: 2.5rem; border-radius: 16px;
      margin-bottom: 2rem; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    }
    header .logo { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; margin-bottom: 0.5rem; }
    header h1 { font-size: 2rem; font-weight: 800; }
    header .subtitle { color: #94a3b8; margin-top: 0.35rem; font-size: 0.9rem; }
    .badge {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.45rem 1.2rem; border-radius: 9999px; font-weight: 700; font-size: 0.95rem;
      background: ${STATUS_COLOR}; color: white; margin-top: 1.25rem; letter-spacing: 0.03em;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .metric-card {
      background: white; border-radius: 12px; padding: 1.25rem;
      border: 1px solid #e2e8f0; box-shadow: 0 1px 4px rgba(0,0,0,0.05); text-align: center;
    }
    .metric-card .value { font-size: 1.65rem; font-weight: 800; color: #0f172a; line-height: 1; }
    .metric-card .label { font-size: 0.72rem; color: #64748b; margin-top: 0.35rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .charts-row { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }
    .chart-card {
      background: white; border-radius: 12px; padding: 1.5rem;
      border: 1px solid #e2e8f0; box-shadow: 0 1px 4px rgba(0,0,0,0.05);
    }
    .chart-card h2, .card h2 {
      font-size: 0.78rem; font-weight: 700; margin-bottom: 1.25rem;
      color: #475569; text-transform: uppercase; letter-spacing: 0.07em;
    }
    .card {
      background: white; border-radius: 12px; padding: 1.75rem;
      margin-bottom: 1.5rem; border: 1px solid #e2e8f0; box-shadow: 0 1px 4px rgba(0,0,0,0.05);
    }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 0.65rem 0.75rem; border-bottom: 1px solid #f1f5f9; font-size: 0.9rem; }
    td:first-child { font-weight: 600; color: #64748b; width: 45%; }
    tr:last-child td { border-bottom: none; }
    code { background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.82em; font-family: "SF Mono","Fira Code",monospace; }
    .link-btn { display: inline-flex; align-items: center; padding: 0.5rem 1.1rem; background: #3b82f6; color: white; border-radius: 6px; text-decoration: none; font-size: 0.85rem; font-weight: 600; }
    .grafana-btn { background: #f46800; }
    footer { text-align: center; color: #94a3b8; font-size: 0.8rem; padding-top: 1.5rem; }
    @media (max-width: 650px) { header h1 { font-size: 1.4rem; } .grid { grid-template-columns: 1fr 1fr; } .charts-row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<div class="container">

  <header>
    <div class="logo">Hotel QA — K6 Performance Testing</div>
    <h1>Smoke Test Report</h1>
    <div class="subtitle">
      Run <code style="background:rgba(255,255,255,0.1);color:#e2e8f0;">${RUN_ID}</code>
      &nbsp;·&nbsp;
      Commit <code style="background:rgba(255,255,255,0.1);color:#e2e8f0;">${COMMIT_SHA:0:7}</code>
    </div>
    <div class="badge">${STATUS_ICON} ${STATUS_TEXT}</div>
  </header>

  <div class="grid">
    <div class="metric-card"><div class="value">${REQ_COUNT}</div><div class="label">Requests</div></div>
    <div class="metric-card"><div class="value">${DUR_AVG}ms</div><div class="label">Avg Duration</div></div>
    <div class="metric-card"><div class="value">${DUR_P95}ms</div><div class="label">p(95) Duration</div></div>
    <div class="metric-card"><div class="value">${FAILED_RATE}</div><div class="label">Error Rate</div></div>
    <div class="metric-card"><div class="value">${CHECKS_RATE}</div><div class="label">Checks OK</div></div>
    <div class="metric-card"><div class="value">${VUS_MAX}</div><div class="label">Max VUs</div></div>
  </div>

  <div class="charts-row">
    <div class="chart-card">
      <h2>Request Duration — Percentiles (ms)</h2>
      <canvas id="durationChart" height="200"></canvas>
    </div>
    <div class="chart-card">
      <h2>Checks Result</h2>
      <canvas id="checksChart" height="200"></canvas>
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
      <tr><td>Checks exitosos</td><td>${CHECKS_RATE} (${CHECKS_PASSES} passes / ${CHECKS_FAILS} fails)</td></tr>
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

  <footer>Hotel QA K6 Smoke Tests &nbsp;·&nbsp; ${GENERATED_AT}</footer>
</div>

<script>
(function () {
  var durAvg  = ${DUR_AVG_N};
  var durP90  = ${DUR_P90_N};
  var durP95  = ${DUR_P95_N};
  var durMax  = ${DUR_MAX_N};
  var chkPass = ${CHECKS_PASSES_N};
  var chkFail = ${CHECKS_FAILS_N};

  var dCtx = document.getElementById('durationChart').getContext('2d');
  new Chart(dCtx, {
    type: 'bar',
    data: {
      labels: ['Avg', 'p(90)', 'p(95)', 'Max'],
      datasets: [{
        label: 'ms',
        data: [durAvg, durP90, durP95, durMax],
        backgroundColor: ['#3b82f6', '#6366f1', '#8b5cf6', '#ef4444'],
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(c) { return c.parsed.y.toFixed(2) + ' ms'; } } }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'milliseconds', color: '#94a3b8' },
          ticks: { color: '#64748b' },
          grid: { color: '#f1f5f9' }
        }
      }
    }
  });

  var cCtx = document.getElementById('checksChart').getContext('2d');
  new Chart(cCtx, {
    type: 'doughnut',
    data: {
      labels: ['Passed', 'Failed'],
      datasets: [{
        data: [chkPass, chkFail],
        backgroundColor: ['#16a34a', '#dc2626'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#475569', font: { size: 12 }, padding: 16 } },
        tooltip: {
          callbacks: {
            label: function(c) {
              var total = c.dataset.data.reduce(function(a, b) { return a + b; }, 0);
              var pct = total > 0 ? (c.parsed / total * 100).toFixed(1) : 0;
              return c.label + ': ' + c.parsed + ' (' + pct + '%)';
            }
          }
        }
      }
    }
  });
})();
</script>
</body>
</html>
HTML

echo "Reporte HTML generado: $OUTPUT_HTML"
