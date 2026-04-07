/**
 * @module payment-scenario
 * @description Escenarios de lógica VU para HU5 + HU6: Pagos e idempotencia.
 *
 * Casos cubiertos:
 *  TC-HU5-01  Idempotencia con pago exitoso: reenvío con misma key retorna mismo resultado
 *  TC-HU5-02  Idempotencia con pago rechazado: reenvío retorna DECLINED sin nuevo cobro
 *  TC-HU5-03  Seguridad: reutilizar key de un hold para otro hold debe ser rechazado
 *  TC-HU6-01  Confirmación: pago SUCCESS cambia hold a CONFIRMED
 *  TC-HU6-02  Error path: pago DECLINED no confirma el hold
 *
 * Nota sobre el simulador: el backend usa un simulador no determinista.
 * Los checks de TC-HU6-01/02 validan el comportamiento según el resultado
 * real devuelto (no se fuerza SUCCESS/DECLINED desde el cliente).
 */

import { sleep } from 'k6';
import { HotelApiClient } from '../clients/hotel-api-client.js';
import { assertResponse, safeParseBody, generateIdempotencyKey } from '../helpers/error-handler.js';

const client = new HotelApiClient();

/**
 * TC-HU6-01 / TC-HU6-02: Procesa un pago para un hold.
 * Retorna el resultado para que el caller pueda ramificar lógica.
 *
 * @param {string} holdId
 * @param {number} amount
 * @param {string} [idempotencyKey] - Si no se pasa, se genera uno nuevo
 * @returns {{ paymentId: string|null, status: string|null, reservationId: string|null, response }}
 */
export function processPayment(holdId, amount, idempotencyKey) {
  const key = idempotencyKey || generateIdempotencyKey();
  const response = client.processPayment(holdId, amount, key);
  const body = safeParseBody(response.body);

  assertResponse(
    response,
    {
      'TC-HU6 | pago retorna 200 o 402': (r) =>
        r.status === 200 || r.status === 402,
      'TC-HU6 | respuesta tiene status de pago': () =>
        body && typeof body.status === 'string',
      'TC-HU6 | status es SUCCESS o DECLINED': () =>
        body && (body.status === 'SUCCESS' || body.status === 'DECLINED'),
    },
    'processPayment'
  );

  const paymentId = body ? body.id : null;
  const paymentStatus = body ? body.status : null;
  const reservationId = null; // Se obtiene consultando el hold después del pago

  sleep(1);
  return { paymentId, status: paymentStatus, reservationId, response, idempotencyKey: key };
}

/**
 * TC-HU5-01 / TC-HU5-02: Reenvía un pago con la misma clave de idempotencia.
 * Verifica que el sistema retorna el resultado original sin crear un nuevo registro.
 *
 * @param {string} holdId
 * @param {number} amount
 * @param {string} idempotencyKey - MISMA clave usada previamente
 * @param {string} expectedStatus - 'SUCCESS' o 'DECLINED'
 * @returns {import('k6/http').Response}
 */
export function retryPaymentIdempotent(holdId, amount, idempotencyKey, expectedStatus) {
  const response = client.processPayment(holdId, amount, idempotencyKey);
  const body = safeParseBody(response.body);

  assertResponse(
    response,
    {
      'TC-HU5-01/02 | reenvío retorna 200': (r) => r.status === 200,
      'TC-HU5-01/02 | retorna mismo status original': () =>
        body && body.status === expectedStatus,
      'TC-HU5-01/02 | retorna mismo idempotency_key': () =>
        body && body.idempotency_key === idempotencyKey,
    },
    'retryPaymentIdempotent'
  );

  sleep(1);
  return response;
}

/**
 * TC-HU5-03: Intenta reutilizar una key de idempotencia de un hold A
 * para pagar un hold B distinto. Debe ser rechazado.
 *
 * @param {string} differentHoldId - Hold distinto al que usó la key originalmente
 * @param {number} amount
 * @param {string} existingKey - Clave ya usada para otro hold
 * @returns {import('k6/http').Response}
 */
export function reuseCrossHoldIdempotencyKey(differentHoldId, amount, existingKey) {
  const response = client.processPayment(differentHoldId, amount, existingKey);

  assertResponse(
    response,
    {
      'TC-HU5-03 | sistema rechaza key cross-hold (400 o 409)': (r) =>
        r.status === 400 || r.status === 409,
    },
    'reuseCrossHoldIdempotencyKey'
  );

  sleep(1);
  return response;
}
