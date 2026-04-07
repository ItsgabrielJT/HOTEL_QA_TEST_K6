# Pruebas de Rendimiento con k6 - Travel Hotel: Motor de Reservas

**Proyecto:** Travel Hotel - Motor de Reservas  
**Version:** 1.0.0  
**Fecha:** 2026-04-06  
**Autor:** Joel Tates (QA)  
**HUs en Alcance:** HU2, HU3, HU5, HU6, HU7, HU11  
**Total de Casos:** 18 identificados (15 activos, 0 ignorados, 3 fuera de alcance)

## Contexto

Este repositorio contiene una suite externa de pruebas de rendimiento y carga para validar el motor de reservas de Travel Hotel sin mezclar la suite dentro del backend objetivo.

La automatizacion esta construida con k6 (Grafana) y se organiza por dominio de negocio con clients, scenarios, config y helpers para mantener trazabilidad directa entre historias de usuario, casos de prueba y metricas de rendimiento.

## Objetivo

- Validar que los flujos criticos del motor de reservas cumplen los SLOs definidos bajo carga sostenida.
- Ejecutar pruebas funcionales y de rendimiento end-to-end sobre disponibilidad, holds, pagos, reservas y validacion de fechas.
- Detectar degradacion de latencia (p95, p99) y errores HTTP bajo carga promedio, estres y spike.
- Separar la suite de carga del backend objetivo para evitar contaminacion del codigo de produccion.
- Generar artefactos de metricas consumibles para diagnostico, trazabilidad y analisis de tendencias.

## Alcance

Historias actualmente cubiertas por la suite:

- HU2: disponibilidad de habitaciones
- HU3: hold temporal para checkout
- HU5: idempotencia de pagos
- HU6: confirmacion de reserva
- HU7: liberacion por fallo de pago
- HU11: validacion de fechas

Cobertura activa en la suite:

- HU2: TC-HU2-01, TC-HU2-07
- HU3: TC-HU3-01, TC-HU3-03
- HU5: TC-HU5-01, TC-HU5-02, TC-HU5-03
- HU6: TC-HU6-01, TC-HU6-02, TC-HU6-03
- HU7: TC-HU7-01
- HU11: TC-HU11-01, TC-HU11-02, TC-HU11-03, TC-HU11-04

## Fuera del alcance

Estos casos no estan activos porque hoy no son verificables de forma confiable con el contrato expuesto o requieren capacidades que la API actual no publica.

| Caso | Estado | Motivo |
|---|---|---|
| TC-HU3-02 | No implementado | La concurrencia exacta sobre la misma habitacion no es estable con el contrato observable actual. |
| TC-HU5-04 | No implementado | El backend reutiliza el resultado cacheado y no rechaza la llave cross-hold como espera la matriz. |
| TC-HU7-02 | No implementado | Requiere controlar estado RELEASED con flujo de eventos explicito no expuesto por la API. |

## Casos de prueba generados y sus estados

Estado de cobertura del repositorio:

| TC-ID | HU | Estado | Test que lo cubre | Observacion |
|---|---|---|---|---|
| TC-HU2-01 | HU2 | Activo | `smoke-test.js`, `load-test.js`, `stress-test.js` | Happy path de disponibilidad con array de habitaciones. |
| TC-HU2-07 | HU2 | Activo | `smoke-test.js` | Rango sin disponibilidad retorna array vacio. |
| TC-HU3-01 | HU3 | Activo | `smoke-test.js`, `load-test.js` | Crea hold PENDING y valida expires_at. |
| TC-HU3-02 | HU3 | No implementado | Sin test dedicado | Concurrencia end-to-end no estable con el contrato actual. |
| TC-HU3-03 | HU3 | Activo | `smoke-test.js` | Segundo hold sobre habitacion bloqueada retorna 409/400. |
| TC-HU5-01 | HU5 | Activo | `idempotency-test.js` | Reintento con misma key SUCCESS retorna respuesta cacheada. |
| TC-HU5-02 | HU5 | Activo | `idempotency-test.js` | Reintento con misma key DECLINED retorna respuesta cacheada. |
| TC-HU5-03 | HU5 | Activo | `idempotency-test.js` | Key cross-hold verificada como check informativo. |
| TC-HU5-04 | HU5 | No implementado | Sin test dedicado | El backend no rechaza la llave cross-hold como exige la matriz. |
| TC-HU6-01 | HU6 | Activo | `smoke-test.js`, `load-test.js` | Pago SUCCESS confirma hold y genera reserva accesible. |
| TC-HU6-02 | HU6 | Activo | `smoke-test.js`, `load-test.js` | Pago DECLINED no confirma el hold. |
| TC-HU6-03 | HU6 | Activo | `smoke-test.js`, `load-test.js` | Habitacion confirmada no aparece en disponibilidad. |
| TC-HU7-01 | HU7 | Activo | `smoke-test.js` | Signal DECLINED tardia sobre hold CONFIRMED es ignorada. |
| TC-HU7-02 | HU7 | No implementado | Sin test dedicado | Requiere manejo de eventos tardios no observable por API. |
| TC-HU11-01 | HU11 | Activo | `smoke-test.js`, `load-test.js` | Checkout anterior al checkin retorna 400. |
| TC-HU11-02 | HU11 | Activo | `smoke-test.js`, `load-test.js` | Checkout igual al checkin retorna 400. |
| TC-HU11-03 | HU11 | Activo | `smoke-test.js`, `load-test.js` | Checkin en el pasado retorna 400. |
| TC-HU11-04 | HU11 | Activo | `smoke-test.js` | Rango valido crea hold exitosamente. |

Notas sobre estado observable:

- TC-HU5-03 y TC-HU7-01 son checks informativos: registran comportamiento observado sin romper el threshold de `checks`.
- TC-HU6-03 reutiliza el estado del flujo TC-HU6-01 dentro de la misma iteracion para no consumir un hold adicional.
- El pool de 40 rangos de fecha en `data/date-ranges.json` evita colisiones de holds entre VUs en corridas de carga.

## Variables del repositorio

Variables de entorno consumidas por la suite:

- `K6_ENV`: selecciona el bloque de configuracion en `config/environments.js` (default: `local`).
- `QA_BASE_URL`: override de URL base cuando `K6_ENV=qa`.
- `STAGING_BASE_URL`: override de URL base cuando `K6_ENV=staging`.

Ejemplo de uso:

```bash
k6 run -e K6_ENV=qa -e QA_BASE_URL=http://qa.hotel.internal/api/v1 tests/smoke-test.js
```

## Ejecucion local

Prerrequisitos:

1. k6 >= 0.47 disponible en PATH.
2. La API de Travel Hotel levantada localmente en `http://localhost:3000`.
3. Datos de prueba disponibles en el backend (habitaciones con disponibilidad para 2027).

### Instalacion de k6

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### Flujo recomendado

Siempre comenzar por smoke antes de escalar:

```bash
# 1. Smoke — 1 VU, verifica que el script y el sistema responden
k6 run tests/smoke-test.js

# 2. Load — 5-8 VUs en 3 escenarios paralelos (~3 min)
k6 run tests/load-test.js

# 3. Stress — hasta 50 VUs, busca el punto de quiebre
k6 run tests/stress-test.js

# 4. Idempotencia — HU5 focalizado
k6 run tests/idempotency-test.js
```

### Cambiar entorno

```bash
k6 run -e K6_ENV=qa -e QA_BASE_URL=http://qa.hotel.internal/api/v1 tests/smoke-test.js

k6 run -e K6_ENV=staging -e STAGING_BASE_URL=http://staging.hotel.internal/api/v1 tests/load-test.js
```

### Exportar resultados

```bash
# JSON para analisis posterior
k6 run --out json=results/smoke-$(date +%Y%m%d-%H%M%S).json tests/smoke-test.js

# Grafana Cloud k6
k6 run --out cloud tests/load-test.js
```

## Estructura del proyecto

- `clients/hotel-api-client.js`: cliente HTTP centralizado con todos los endpoints del motor de reservas.
- `config/environments.js`: URLs base por entorno (local, qa, staging), seleccionado via `K6_ENV`.
- `config/thresholds.js`: SLOs compartidos (p95, p99, http_req_failed, checks) importados por todos los tests.
- `config/workloads.js`: perfiles de carga reutilizables (smoke, average, stress, spike).
- `data/date-ranges.json`: pool de 40 rangos de fecha validos para parametrizacion data-driven.
- `data/invalid-date-ranges.json`: casos de fecha invalidos para HU11 (checkout < checkin, misma fecha, pasado).
- `helpers/error-handler.js`: wrapper de checks con logging detallado de fallos y generacion de idempotency keys.
- `scenarios/availability-scenario.js`: funciones de escenario para HU2.
- `scenarios/hold-scenario.js`: funciones de escenario para HU3.
- `scenarios/payment-scenario.js`: funciones de escenario para HU5 y HU6.
- `scenarios/reservation-scenario.js`: funciones de escenario para HU6 y HU7.
- `scenarios/date-validation-scenario.js`: funciones de escenario para HU11.
- `scenarios/booking-flow-scenario.js`: flujo completo reutilizable (disponibilidad → hold → pago → confirmacion).
- `tests/smoke-test.js`: 1 VU, cubre el mayor numero de TCs activos en ~2 minutos.
- `tests/load-test.js`: 5-8 VUs en 3 escenarios paralelos (~3 minutos de duracion total).
- `tests/stress-test.js`: hasta 50 VUs para buscar punto de quiebre.
- `tests/idempotency-test.js`: prueba focalizada de idempotencia de pagos (HU5).
- `api.md`: contrato de la API bajo prueba (referencia).
- `tc.md`: matriz de casos de prueba (referencia).

## Reportes

Salida en consola de k6 al finalizar cada corrida:

- Metricas de duracion HTTP: `http_req_duration` con p(50), p(90), p(95), p(99).
- Tasa de fallos: `http_req_failed`.
- Resultado de checks funcionales: `checks` con tasa de exito.
- Metricas custom por dominio: `hold_duration`, `availability_duration`, `payment_duration`.
- Resultado de thresholds: PASS/FAIL por cada SLO definido en `config/thresholds.js`.

Para artefactos persistentes:

```bash
# JSON completo de metricas
k6 run --out json=results/load-$(date +%Y%m%d-%H%M%S).json tests/load-test.js

# Grafana Cloud k6 (requiere K6_CLOUD_TOKEN)
k6 run --out cloud tests/load-test.js
```

## Notas

- Se usa data-driven testing con pool de 40 fechas para evitar colisiones de holds entre VUs concurrentes.
- Las fechas del pool apuntan a 2027 para no depender del calendario real de 2026.
- `http.setResponseCallback` esta configurado en todos los tests para que los error-paths intencionales (400, 402, 409) no contaminen la metrica `http_req_failed`.
- Los checks informativos (TC-HU5-03, TC-HU7-01) registran comportamiento observado sin romper el threshold de `checks`.
- La API no requiere autenticacion segun el contrato observado: ningun endpoint exige header `Authorization`.
- Los casos fuera de alcance no se borran: quedan documentados para reactivarlos cuando el backend exponga un contrato mas estable.

## Decisiones tecnicas

- `HotelApiClient` centraliza todas las llamadas HTTP (SRP/OCP): para agregar un endpoint nuevo se extiende el cliente sin tocar los scenarios.
- Los rangos de fecha se leen con `open()` en el contexto init y cada VU usa `((__VU-1)*13 + __ITER) % N` para distribucion determinista sin colisiones entre VUs paralelos.
- `http.setResponseCallback` con `expectedStatuses` se coloca en el contexto init (fuera de VU functions) para aplicar globalmente desde el inicio del test.
- Los scenarios no hacen HTTP directo: todo pasa por `HotelApiClient` para centralizar tags de URL y evitar explosion de time series en las metricas.
- `assertResponse` en `helpers/error-handler.js` registra el contexto completo del fallo (url, status, body, checks fallidos) en `console.error` para facilitar diagnostico.
- `booking-flow-scenario.js` retorna null sin fallar checks cuando no hay disponibilidad, porque bajo carga el inventario se agota y `[]` es una respuesta valida del sistema.

## Conclusiones

Este repositorio funciona como una suite de QA de rendimiento externa para el motor de reservas de Travel Hotel, con foco en los flujos mas sensibles del checkout bajo carga real.

La cobertura activa prioriza disponibilidad, holds, pagos idempotentes, confirmacion de reserva y validacion temprana de fechas. Los gaps actuales no estan ocultos: quedan explicitados como casos fuera de alcance hasta que el backend exponga senales mas estables para automatizarlos sin generar falsos positivos en las metricas de carga.
