/**
 * @module booking-flow-scenario
 * @description Flujo completo de reserva: disponibilidad → hold → pago → confirmación.
 * Es el escenario reutilizable principal que se importa en los tests de carga.
 *
 * Cubre de forma integral:
 *  TC-HU2-01, TC-HU3-01, TC-HU5-01, TC-HU6-01, TC-HU6-02, TC-HU6-03
 *
 * El flujo se adapta según el resultado real del simulador de pagos:
 *  - Si pago=SUCCESS → verifica hold CONFIRMED + reserva accesible
 *  - Si pago=DECLINED → verifica hold NO confirmado
 */

import { sleep } from 'k6';
import { HotelApiClient } from '../clients/hotel-api-client.js';
import { assertResponse, safeParseBody, generateIdempotencyKey } from '../helpers/error-handler.js';

const client = new HotelApiClient();

/**
 * Flujo completo de reserva de una habitación.
 *
 * @param {string} checkin  - YYYY-MM-DD
 * @param {string} checkout - YYYY-MM-DD
 * @returns {{
 *   roomId: string|null,
 *   holdId: string|null,
 *   paymentStatus: string|null,
 *   reservationId: string|null
 * }}
 */
export function completeBookingFlow(checkin, checkout) {
  // ── Paso 1: Disponibilidad ──────────────────────────────────────
  const availResponse = client.getAvailableRooms(checkin, checkout);
  const rooms = safeParseBody(availResponse.body);

  assertResponse(
    availResponse,
    {
      'BookingFlow | GET disponibilidad retorna 200': (r) => r.status === 200,
      'BookingFlow | respuesta es array': () => Array.isArray(rooms),
    },
    'completeBookingFlow:availability'
  );

  if (!Array.isArray(rooms) || rooms.length === 0) {
    // Sin habitaciones disponibles para este rango: es un resultado válido del sistema.
    // Se omite el flujo de hold/pago para este VU en esta iteración.
    console.log(`[BookingFlow] Sin habitaciones para ${checkin}/${checkout} — iteración omitida`);
    return { roomId: null, holdId: null, paymentStatus: null, reservationId: null };
  }

  // Seleccionar la primera habitación disponible
  const room = rooms[0];
  sleep(0.5);

  // ── Paso 2: Crear Hold ──────────────────────────────────────────
  const holdResponse = client.createHold(room.id, checkin, checkout);
  const holdBody = safeParseBody(holdResponse.body);

  assertResponse(
    holdResponse,
    {
      'BookingFlow | POST hold retorna 201': (r) => r.status === 201,
      'BookingFlow | hold status es PENDING': () =>
        holdBody && holdBody.status === 'PENDING',
      'BookingFlow | hold tiene expires_at': () =>
        holdBody && typeof holdBody.expires_at === 'string',
    },
    'completeBookingFlow:hold'
  );

  if (!holdBody || !holdBody.id) {
    return { roomId: room.id, holdId: null, paymentStatus: null, reservationId: null };
  }

  sleep(0.5);

  // ── Paso 3: Pago ────────────────────────────────────────────────
  const amount = parseFloat(room.price_per_night || '80') ||  80;
  const idempotencyKey = generateIdempotencyKey();

  const payResponse = client.processPayment(holdBody.id, amount, idempotencyKey);
  const payBody = safeParseBody(payResponse.body);

  assertResponse(
    payResponse,
    {
      'BookingFlow | POST pago retorna 200 o 402': (r) =>
        r.status === 200 || r.status === 402,
      'BookingFlow | pago tiene status': () =>
        payBody && typeof payBody.status === 'string',
    },
    'completeBookingFlow:payment'
  );

  const paymentStatus = payBody ? payBody.status : null;
  sleep(0.5);

  // ── Paso 4: Verificar resultado según simulador ─────────────────
  let reservationId = null;

  if (paymentStatus === 'SUCCESS') {
    const updatedHoldResponse = client.getHold(holdBody.id);
    const updatedHold = safeParseBody(updatedHoldResponse.body);

    assertResponse(
      updatedHoldResponse,
      {
        'TC-HU6-01 | hold pasa a CONFIRMED tras pago SUCCESS': () =>
          updatedHold && updatedHold.status === 'CONFIRMED',
        'TC-HU6-01 | hold tiene reservation_id': () =>
          updatedHold && updatedHold.reservation_id,
      },
      'completeBookingFlow:verify-confirmed'
    );

    if (updatedHold && updatedHold.reservation_id) {
      reservationId = updatedHold.reservation_id;

      const resResponse = client.getReservationById(reservationId);
      const resBody = safeParseBody(resResponse.body);

      assertResponse(
        resResponse,
        {
          'TC-HU6-01 | GET reserva retorna 200': (r) => r.status === 200,
          'TC-HU6-01 | reserva status CONFIRMED': () =>
            resBody && resBody.status === 'CONFIRMED',
          'TC-HU6-03 | reserva tiene reservation_code': () =>
            resBody && typeof resBody.reservation_code === 'string',
        },
        'completeBookingFlow:reservation'
      );

      // TC-HU6-03: habitación no debe aparecer disponible
      const availCheck = client.getAvailableRooms(checkin, checkout);
      const availCheckBody = safeParseBody(availCheck.body);
      assertResponse(
        availCheck,
        {
          'TC-HU6-03 | habitación confirmada no aparece disponible': () => {
            if (!Array.isArray(availCheckBody)) return true;
            return !availCheckBody.some((r) => r.id === room.id);
          },
        },
        'completeBookingFlow:availability-after-confirm'
      );
    }
  } else if (paymentStatus === 'DECLINED') {
    const updatedHoldResponse = client.getHold(holdBody.id);
    const updatedHold = safeParseBody(updatedHoldResponse.body);

    assertResponse(
      updatedHoldResponse,
      {
        'TC-HU6-02 | hold NO es CONFIRMED tras pago DECLINED': () =>
          updatedHold && updatedHold.status !== 'CONFIRMED',
      },
      'completeBookingFlow:verify-not-confirmed'
    );
  }

  sleep(1);
  return {
    roomId: room.id,
    holdId: holdBody.id,
    paymentStatus,
    reservationId,
  };
}
