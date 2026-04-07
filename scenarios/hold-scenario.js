/**
 * @module hold-scenario
 * @description Escenarios de lógica VU para HU3: Bloqueo Atómico de Hold.
 *
 * Casos cubiertos:
 *  TC-HU3-01  Happy path: crear hold exitoso → verifica 201, PENDING, expires_at
 *  TC-HU3-03  Error path: segundo hold sobre habitación ya bloqueada → 409/400
 *
 * TC-HU3-02 (concurrencia) se implementa en el test de concurrencia (stress-test.js)
 * con múltiples VUs lanzando simultáneamente. Está marcado como "No activo" en la
 * matriz porque requiere timing preciso end-to-end, pero se deja el escenario
 * de base para su eventual activación.
 */

import { sleep } from 'k6';
import { HotelApiClient } from '../clients/hotel-api-client.js';
import { assertResponse, safeParseBody } from '../helpers/error-handler.js';

const client = new HotelApiClient();

/**
 * TC-HU3-01: Crea un hold sobre una habitación disponible.
 * Verifica: HTTP 201, status PENDING, presencia de expires_at, room_id correcto.
 *
 * @param {string} roomId   - UUID de la habitación (obtenido de disponibilidad)
 * @param {string} checkin  - YYYY-MM-DD
 * @param {string} checkout - YYYY-MM-DD
 * @returns {{ holdId: string|null, response: import('k6/http').Response }}
 */
export function createHoldHappyPath(roomId, checkin, checkout) {
  const response = client.createHold(roomId, checkin, checkout);
  const body = safeParseBody(response.body);

  assertResponse(
    response,
    {
      'TC-HU3-01 | status es 201': (r) => r.status === 201,
      'TC-HU3-01 | hold tiene status PENDING': () =>
        body && body.status === 'PENDING',
      'TC-HU3-01 | hold incluye expires_at': () =>
        body && typeof body.expires_at === 'string' && body.expires_at.length > 0,
      'TC-HU3-01 | hold tiene id': () =>
        body && typeof body.id === 'string' && body.id.length > 0,
      'TC-HU3-01 | room_id coincide con el solicitado': () =>
        body && body.room_id === roomId,
    },
    'createHoldHappyPath'
  );

  const holdId = body && body.id ? body.id : null;
  sleep(1);
  return { holdId, response };
}

/**
 * TC-HU3-03: Intenta crear un segundo hold sobre una habitación que ya
 * tiene un hold PENDING activo. El sistema debe responder con 409 o 400.
 *
 * @param {string} roomId
 * @param {string} checkin
 * @param {string} checkout
 * @returns {import('k6/http').Response}
 */
export function createHoldOnBlockedRoom(roomId, checkin, checkout) {
  const response = client.createHold(roomId, checkin, checkout);

  assertResponse(
    response,
    {
      'TC-HU3-03 | sistema rechaza hold duplicado (409 o 400)': (r) =>
        r.status === 409 || r.status === 400,
      'TC-HU3-03 | respuesta tiene mensaje de error': (r) => {
        const body = safeParseBody(r.body);
        return body && (body.message || body.error || body.detail);
      },
    },
    'createHoldOnBlockedRoom'
  );

  sleep(1);
  return response;
}

/**
 * Consulta el estado de un hold existente.
 * Verifica: HTTP 200, hold tiene id, status y remaining_seconds.
 *
 * @param {string} holdId
 * @returns {{ hold: Object|null, response: import('k6/http').Response }}
 */
export function getHoldStatus(holdId) {
  const response = client.getHold(holdId);
  const body = safeParseBody(response.body);

  assertResponse(
    response,
    {
      'getHold | status es 200': (r) => r.status === 200,
      'getHold | hold tiene id': () =>
        body && typeof body.id === 'string',
      'getHold | hold tiene status': () =>
        body && typeof body.status === 'string',
      'getHold | hold tiene remaining_seconds': () =>
        body && typeof body.remaining_seconds === 'number',
    },
    'getHoldStatus'
  );

  sleep(1);
  return { hold: body, response };
}
