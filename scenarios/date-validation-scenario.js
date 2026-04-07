/**
 * @module date-validation-scenario
 * @description Escenarios de lógica VU para HU11: Validación de integridad de fechas.
 *
 * Casos cubiertos:
 *  TC-HU11-01  checkout < checkin          → 400
 *  TC-HU11-02  checkout == checkin          → 400 (estancia mínima 1 noche)
 *  TC-HU11-03  checkin en el pasado         → 400
 *  TC-HU11-04  Happy path: fechas válidas   → hold creado exitosamente
 *
 * La validación ocurre en el endpoint POST /rooms/{roomId}/hold (y también
 * en GET /rooms/available según la API). Se usa una habitación real obtenida
 * en el setup del test para el happy path.
 */

import { sleep } from 'k6';
import { HotelApiClient } from '../clients/hotel-api-client.js';
import { assertResponse, safeParseBody } from '../helpers/error-handler.js';

const client = new HotelApiClient();

/**
 * TC-HU11-01: checkout anterior a checkin → 400
 *
 * @param {string} roomId
 * @returns {import('k6/http').Response}
 */
export function holdWithCheckoutBeforeCheckin(roomId) {
  const response = client.createHold(roomId, '2026-10-20', '2026-10-18');

  assertResponse(
    response,
    {
      'TC-HU11-01 | status es 400': (r) => r.status === 400,
      'TC-HU11-01 | no se creó hold (sin id en body)': (r) => {
        const body = safeParseBody(r.body);
        return !body || !body.id;
      },
    },
    'holdWithCheckoutBeforeCheckin'
  );

  sleep(0.5);
  return response;
}

/**
 * TC-HU11-02: checkin == checkout → 400 (estancia mínima 1 noche)
 *
 * @param {string} roomId
 * @returns {import('k6/http').Response}
 */
export function holdWithSameDate(roomId) {
  const response = client.createHold(roomId, '2026-10-20', '2026-10-20');

  assertResponse(
    response,
    {
      'TC-HU11-02 | status es 400': (r) => r.status === 400,
      'TC-HU11-02 | no se creó hold': (r) => {
        const body = safeParseBody(r.body);
        return !body || !body.id;
      },
    },
    'holdWithSameDate'
  );

  sleep(0.5);
  return response;
}

/**
 * TC-HU11-03: checkin en el pasado → 400
 *
 * @param {string} roomId
 * @returns {import('k6/http').Response}
 */
export function holdWithPastDates(roomId) {
  const response = client.createHold(roomId, '2025-01-01', '2025-01-03');

  assertResponse(
    response,
    {
      'TC-HU11-03 | status es 400': (r) => r.status === 400,
      'TC-HU11-03 | no se creó hold': (r) => {
        const body = safeParseBody(r.body);
        return !body || !body.id;
      },
    },
    'holdWithPastDates'
  );

  sleep(0.5);
  return response;
}

/**
 * TC-HU11-04: Fechas válidas en rango futuro → hold creado (200 o 201)
 *
 * @param {string} roomId
 * @param {string} checkin
 * @param {string} checkout
 * @returns {{ holdId: string|null, response: import('k6/http').Response }}
 */
export function holdWithValidDates(roomId, checkin, checkout) {
  const response = client.createHold(roomId, checkin, checkout);
  const body = safeParseBody(response.body);

  assertResponse(
    response,
    {
      'TC-HU11-04 | status es 201 (hold creado)': (r) =>
        r.status === 201 || r.status === 200,
      'TC-HU11-04 | hold tiene id en respuesta': () =>
        body && typeof body.id === 'string' && body.id.length > 0,
      'TC-HU11-04 | hold tiene status PENDING': () =>
        body && body.status === 'PENDING',
    },
    'holdWithValidDates'
  );

  sleep(1);
  return { holdId: body && body.id ? body.id : null, response };
}

/**
 * Valida las fechas inválidas también sobre el endpoint de disponibilidad.
 * GET /rooms/available también debe retornar 400 para parámetros inválidos.
 *
 * @param {string} checkin
 * @param {string} checkout
 * @returns {import('k6/http').Response}
 */
export function availabilityWithInvalidDates(checkin, checkout) {
  const response = client.getAvailableRooms(checkin, checkout);

  assertResponse(
    response,
    {
      'HU11 | disponibilidad rechaza fechas inválidas (400)': (r) =>
        r.status === 400,
    },
    'availabilityWithInvalidDates'
  );

  sleep(0.5);
  return response;
}
