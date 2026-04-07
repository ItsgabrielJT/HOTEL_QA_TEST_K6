/**
 * @module thresholds
 * @description SLOs compartidos entre todos los test scripts.
 * Importar en cada test y mergear con thresholds específicos si aplica.
 *
 * Criterios:
 *  - p(95) de todas las requests < 800 ms
 *  - p(99) de todas las requests < 1500 ms
 *  - Tasa de errores HTTP < 1 %
 *  - Checks deben pasar >= 95 %
 */

export const BASE_THRESHOLDS = {
  // Latencia global
  http_req_duration: ['p(95)<800', 'p(99)<1500'],
  // Tasa de fallos HTTP (4xx y 5xx cuentan como fallo segun http_req_failed)
  http_req_failed: ['rate<0.01'],
  // Checks funcionales: al menos 95 % deben pasar
  checks: ['rate>=0.95'],
};

/**
 * Umbrales para el flujo crítico de creación de hold.
 * Más estrictos porque es la operación de mayor riesgo de negocio.
 */
export const HOLD_THRESHOLDS = {
  'http_req_duration{endpoint:create_hold}': ['p(95)<600'],
};

/**
 * Umbrales para consulta de disponibilidad.
 * Es la operación de mayor frecuencia; debe ser rápida.
 */
export const AVAILABILITY_THRESHOLDS = {
  'http_req_duration{endpoint:get_availability}': ['p(95)<500'],
};

/**
 * Umbrales para el flujo de pago.
 */
export const PAYMENT_THRESHOLDS = {
  'http_req_duration{endpoint:process_payment}': ['p(95)<1000'],
};
