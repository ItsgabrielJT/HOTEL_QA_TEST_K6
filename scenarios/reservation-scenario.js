/**
 * @module reservation-scenario
 * @description Escenarios de lógica VU para HU6 + HU7: Confirmación de reserva
 * y liberación proactiva por fallo.
 *
 * Casos cubiertos:
 *  TC-HU6-01  Confirmación exitosa: hold cambia a CONFIRMED, habitación no disponible
 *  TC-HU6-02  Pago rechazado: hold NO cambia a CONFIRMED
 *  TC-HU6-03  Edge case: habitación confirmada no aparece en búsqueda de disponibilidad
 *  TC-HU7-01  Señal tardía DECLINED sobre hold CONFIRMED: estado no cambia
 */

import { sleep } from 'k6';
import { HotelApiClient } from '../clients/hotel-api-client.js';
import { assertResponse, safeParseBody } from '../helpers/error-handler.js';

const client = new HotelApiClient();

/**
 * TC-HU6-01: Después de un pago SUCCESS, verifica que el hold pasó a CONFIRMED
 * y que la reserva está accesible.
 *
 * @param {string} holdId
 * @param {string} checkin
 * @param {string} checkout
 * @returns {{ reservation: Object|null, holdStatus: string|null }}
 */
export function verifyConfirmedReservation(holdId, checkin, checkout) {
  // Consultar el hold actualizado
  const holdResponse = client.getHold(holdId);
  const holdBody = safeParseBody(holdResponse.body);

  assertResponse(
    holdResponse,
    {
      'TC-HU6-01 | hold retorna 200': (r) => r.status === 200,
      'TC-HU6-01 | hold está CONFIRMED': () =>
        holdBody && holdBody.status === 'CONFIRMED',
      'TC-HU6-01 | hold tiene reservation_id': () =>
        holdBody && holdBody.reservation_id && holdBody.reservation_id.length > 0,
    },
    'verifyConfirmedReservation:hold'
  );

  let reservation = null;

  if (holdBody && holdBody.reservation_id) {
    const resResponse = client.getReservationById(holdBody.reservation_id);
    reservation = safeParseBody(resResponse.body);

    assertResponse(
      resResponse,
      {
        'TC-HU6-01 | reserva retorna 200': (r) => r.status === 200,
        'TC-HU6-01 | reserva tiene status CONFIRMED': () =>
          reservation && reservation.status === 'CONFIRMED',
        'TC-HU6-01 | reserva tiene reservation_code': () =>
          reservation &&
          typeof reservation.reservation_code === 'string' &&
          reservation.reservation_code.length > 0,
      },
      'verifyConfirmedReservation:reservation'
    );
  }

  // TC-HU6-03: la habitación no debe aparecer disponible para ese rango
  if (holdBody && holdBody.room_id) {
    const availResponse = client.getAvailableRooms(checkin, checkout);
    const availBody = safeParseBody(availResponse.body);

    assertResponse(
      availResponse,
      {
        'TC-HU6-03 | disponibilidad retorna 200': (r) => r.status === 200,
        'TC-HU6-03 | habitación confirmada no aparece disponible': () => {
          if (!Array.isArray(availBody)) return false; // respuesta inválida → fallo real, no pase silencioso
          return !availBody.some((room) => room.id === holdBody.room_id);
        },
      },
      'verifyConfirmedReservation:availability-check'
    );
  }

  sleep(1);
  return { reservation, holdStatus: holdBody ? holdBody.status : null };
}

/**
 * TC-HU6-02: Después de un pago DECLINED, el hold NO debe estar CONFIRMED.
 *
 * @param {string} holdId
 * @returns {string|null} - estado del hold
 */
export function verifyHoldNotConfirmedAfterDecline(holdId) {
  const holdResponse = client.getHold(holdId);
  const holdBody = safeParseBody(holdResponse.body);

  assertResponse(
    holdResponse,
    {
      'TC-HU6-02 | hold retorna 200': (r) => r.status === 200,
      'TC-HU6-02 | hold NO está CONFIRMED tras pago DECLINED': () =>
        holdBody !== null && typeof holdBody === 'object' && holdBody.status !== 'CONFIRMED',
    },
    'verifyHoldNotConfirmedAfterDecline'
  );

  sleep(1);
  return holdBody ? holdBody.status : null;
}

/**
 * TC-HU7-01: Envía una señal de DECLINED tardía a un hold ya CONFIRMED.
 * El sistema debe ignorarla o retornar error controlado sin cambiar el estado.
 *
 * Implementación: intenta un segundo pago con nueva key sobre el mismo hold.
 * Si el hold está CONFIRMED el backend debería rechazar el reintento.
 *
 * @param {string} holdId
 * @param {number} amount
 * @param {string} idempotencyKey - nueva key (no idempotente: payload diferente)
 * @returns {import('k6/http').Response}
 */
export function sendLateDeclinedSignal(holdId, amount, idempotencyKey) {
  const response = client.processPayment(holdId, amount, idempotencyKey);
  const body = safeParseBody(response.body);

  // El sistema puede retornar error (4xx) o el estado original CONFIRMED.
  // Lo importante es que el hold siga CONFIRMED después.
  assertResponse(
    response,
    {
      'TC-HU7-01 | señal tardía no provoca 500': (r) => r.status < 500,
    },
    'sendLateDeclinedSignal'
  );

  // Verificar que el hold aún está CONFIRMED
  const holdResponse = client.getHold(holdId);
  const holdBody = safeParseBody(holdResponse.body);

  assertResponse(
    holdResponse,
    {
      'TC-HU7-01 | hold sigue CONFIRMED tras señal tardía': () =>
        holdBody && holdBody.status === 'CONFIRMED',
    },
    'sendLateDeclinedSignal:verify-hold'
  );

  sleep(1);
  return response;
}
