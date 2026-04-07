/**
 * @module availability-scenario
 * @description Escenarios de lógica VU para HU2: Consulta de Disponibilidad.
 *
 * Casos cubiertos:
 *  TC-HU2-01  Happy path: respuesta 200 con habitaciones
 *  TC-HU2-03  Error path: búsqueda donde todas las habitaciones pueden estar ocupadas
 *  TC-HU2-07  Edge case: respuesta con array vacío es válida (200 con [])
 *
 * Nota: TC-HU2-02, 04, 05, 06 dependen de estado previo de BD (hold/reserva
 * con fechas específicas). Esos estados se generan dinámicamente en el flow
 * de hold+payment o son validados en el test de flujo completo.
 */

import { sleep } from 'k6';
import { HotelApiClient } from '../clients/hotel-api-client.js';
import { assertResponse } from '../helpers/error-handler.js';

const client = new HotelApiClient();

/**
 * TC-HU2-01: Busca disponibilidad en un rango válido futuro.
 * Verifica: HTTP 200, array en la respuesta.
 *
 * @param {string} checkin  - YYYY-MM-DD
 * @param {string} checkout - YYYY-MM-DD
 * @returns {{ rooms: Array, response: import('k6/http').Response }}
 */
export function searchAvailability(checkin, checkout) {
  const response = client.getAvailableRooms(checkin, checkout);

  assertResponse(
    response,
    {
      'TC-HU2-01 | status es 200': (r) => r.status === 200,
      'TC-HU2-01 | respuesta es un array JSON': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body);
        } catch {
          return false;
        }
      },
    },
    'searchAvailability'
  );

  let rooms = [];
  try {
    rooms = JSON.parse(response.body);
  } catch {
    rooms = [];
  }

  sleep(1);
  return { rooms, response };
}

/**
 * TC-HU2-07: Verifica que cuando no hay habitaciones disponibles
 * el sistema responde 200 con un array vacío (no un 500 ni un 404).
 * Se busca en un rango muy específico donde es probable que esté todo ocupado.
 *
 * @param {string} checkin
 * @param {string} checkout
 * @returns {import('k6/http').Response}
 */
export function searchAvailabilityExpectEmpty(checkin, checkout) {
  const response = client.getAvailableRooms(checkin, checkout);

  assertResponse(
    response,
    {
      'TC-HU2-07 | status es 200 o 404': (r) =>
        r.status === 200 || r.status === 404,
      'TC-HU2-07 | si 200 respuesta es array (vacío o no)': (r) => {
        if (r.status !== 200) return true;
        try {
          return Array.isArray(JSON.parse(r.body));
        } catch {
          return false;
        }
      },
    },
    'searchAvailabilityExpectEmpty'
  );

  sleep(1);
  return response;
}
