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

/**
 * Umbrales para la prueba de doble-booking.
 *
 * Métrica principal: reservas confirmadas para el mismo slot (habitación + rango de fechas).
 * Umbral MVP: 0 doble-bookings con 20 usuarios simultáneos.
 *
 *  - double_booking_reservations_confirmed < 2
 *      Solo 0 o 1 reserva puede quedar CONFIRMED para el mismo slot.
 *      Si llega a 2+, hay doble-booking.
 *
 *  - double_booking_holds_created < 2
 *      El hold-lock debe rechazar el segundo intento con 409/400.
 *      Si 2+ holds son creados (201) sobre el mismo slot, el sistema
 *      no está protegiendo atómicamente el inventario.
 */
export const DOUBLE_BOOKING_THRESHOLDS = {
  'double_booking_reservations_confirmed': ['count<2'],
  'double_booking_holds_created':          ['count<2'],
};
