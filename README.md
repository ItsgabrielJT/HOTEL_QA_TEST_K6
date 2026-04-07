# Travel Hotel — Suite de Pruebas de Rendimiento k6

**Proyecto:** Travel Hotel — Motor de Reservas  
**Versión:** 1.0.0-MVP  
**Autor:** QA Senior  
**Stack:** k6 (Grafana)  
**Referencia:** tc.md · api.md

---

## Casos de prueba implementados

| TC-ID | HU | Descripción | Test que lo cubre |
|---|---|---|---|
| TC-HU2-01 | HU2 | Disponibilidad happy path (200, array) | `smoke-test.js`, `load-test.js`, `stress-test.js` |
| TC-HU2-07 | HU2 | Disponibilidad sin resultados → 200 con `[]` | `smoke-test.js` |
| TC-HU3-01 | HU3 | Crear hold exitoso → 201, PENDING, expires_at | `smoke-test.js`, `load-test.js` |
| TC-HU3-03 | HU3 | Segundo hold sobre habitación bloqueada → 409/400 | `smoke-test.js` |
| TC-HU5-01 | HU5 | Reenvío pago SUCCESS con misma key → mismo resultado | `idempotency-test.js` |
| TC-HU5-02 | HU5 | Reenvío pago DECLINED con misma key → mismo resultado | `idempotency-test.js` |
| TC-HU5-03 | HU5 | Key cross-hold → rechazado (check informativo) | `idempotency-test.js` |
| TC-HU6-01 | HU6 | Pago SUCCESS → hold CONFIRMED + reserva accesible | `smoke-test.js`, `load-test.js` |
| TC-HU6-02 | HU6 | Pago DECLINED → hold NO CONFIRMED | `smoke-test.js`, `load-test.js` |
| TC-HU6-03 | HU6 | Habitación confirmada no aparece en disponibilidad | `smoke-test.js`, `load-test.js` |
| TC-HU7-01 | HU7 | Señal DECLINED tardía sobre hold CONFIRMED → ignorada | `smoke-test.js` |
| TC-HU11-01 | HU11 | checkout < checkin → 400 | `smoke-test.js`, `load-test.js` |
| TC-HU11-02 | HU11 | checkin == checkout → 400 (estancia mínima) | `smoke-test.js`, `load-test.js` |
| TC-HU11-03 | HU11 | Fechas en el pasado → 400 | `smoke-test.js`, `load-test.js` |
| TC-HU11-04 | HU11 | Fechas válidas → hold creado exitosamente | `smoke-test.js` |

### Casos NO implementados y motivo

| TC-ID | Motivo |
|---|---|
| TC-HU3-02 | Concurrencia exacta sobre la misma habitación — inestable end-to-end con el contrato actual |
| TC-HU5-04 | Backend cachea la key cross-hold y no la rechaza; check informativo en `idempotency-test.js` |
| TC-HU7-02 | Requiere controlar estado RELEASED con flujo de eventos explícito no expuesto por la API |


---

## Estructura del proyecto

```
HOTEL_QA_TEST_K6/
├── clients/
│   └── hotel-api-client.js      # Cliente HTTP centralizado (un solo lugar por endpoint)
├── config/
│   ├── environments.js          # URLs por entorno (local, qa, staging)
│   ├── thresholds.js            # SLOs compartidos (p95, p99, error rate)
│   └── workloads.js             # Perfiles de carga (smoke, average, stress, spike)
├── data/
│   ├── date-ranges.json         # Pool de rangos de fecha válidos para parametrización
│   └── invalid-date-ranges.json # Casos de fecha inválidos para HU11
├── helpers/
│   └── error-handler.js         # Wrapper de checks con logging detallado de fallos
├── scenarios/
│   ├── availability-scenario.js  # HU2: consulta de disponibilidad
│   ├── hold-scenario.js          # HU3: creación y consulta de holds
│   ├── payment-scenario.js       # HU5+HU6: pagos e idempotencia
│   ├── reservation-scenario.js   # HU6+HU7: confirmación y señales tardías
│   ├── date-validation-scenario.js # HU11: validación de fechas
│   └── booking-flow-scenario.js  # Flujo completo reutilizable
├── tests/
│   ├── smoke-test.js            # 1 VU — verifica que todo funciona
│   ├── load-test.js             # 5-8 VUs — carga promedio
│   ├── stress-test.js           # hasta 50 VUs — punto de quiebre
│   └── idempotency-test.js      # HU5 — prueba focalizada de idempotencia
├── api.md                       # Contrato de la API (referencia)
└── tc.md                        # Matriz de casos de prueba (referencia)
```

---

## Requisitos

- [k6](https://grafana.com/docs/k6/latest/get-started/installation/) >= 0.47
- API levantada en `http://localhost:5173/api/v1` (o configurar `K6_ENV`)

### Instalación de k6

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

---

## Ejecución

### Flujo recomendado: siempre comenzar por smoke

```bash
# 1. Smoke test — verificar que el script y el sistema responden
k6 run tests/smoke-test.js

# 2. Load test — carga promedio con múltiples escenarios
k6 run tests/load-test.js

# 3. Stress test — buscar el límite del sistema
k6 run tests/stress-test.js

# 4. Test de idempotencia focalizado
k6 run tests/idempotency-test.js
```

### Cambiar entorno

```bash
# Contra QA con URL personalizada
k6 run -e K6_ENV=qa -e QA_BASE_URL=http://qa.hotel.internal/api/v1 tests/smoke-test.js

# Contra staging
k6 run -e K6_ENV=staging -e STAGING_BASE_URL=http://staging.hotel.internal/api/v1 tests/load-test.js
```

### Exportar resultados

```bash
# Resultados en JSON para análisis posterior
k6 run --out json=results/smoke-$(date +%Y%m%d-%H%M%S).json tests/smoke-test.js

# Enviar métricas a Grafana Cloud k6
k6 run --out cloud tests/load-test.js
```

---

## SLOs (Thresholds)

Definidos en [config/thresholds.js](config/thresholds.js):

| Métrica | Smoke / Load | Stress |
|---|---|---|
| `http_req_duration p(95)` | < 800 ms | < 1500 ms |
| `http_req_duration p(99)` | < 1500 ms | < 3000 ms |
| `http_req_failed` | < 1 % | < 5 % |
| `checks` (funcionales) | ≥ 95 % | ≥ 85 % |
| Hold `p(95)` | < 600 ms | — |
| Disponibilidad `p(95)` | < 500 ms | — |
| Pago `p(95)` | < 1000 ms | — |

---

## Principios de diseño

- **SRP**: cada módulo tiene una única responsabilidad (client, scenario, config, helper).
- **OCP**: para agregar un nuevo endpoint se extiende `HotelApiClient` sin modificar scenarios.
- **DRY**: los flujos de negocio viven en `scenarios/`; los tests los importan y aplican workloads.
- **Data-Driven**: los rangos de fecha se leen de `data/` con `open()` en el contexto `init`.
- **No HTTP en init**: todas las peticiones ocurren dentro de funciones VU o `setup()`/`teardown()`.
- **URL Grouping**: cada llamada HTTP lleva `tags: { endpoint: '...' }` para métricas limpias y evitar explosión de time series.
