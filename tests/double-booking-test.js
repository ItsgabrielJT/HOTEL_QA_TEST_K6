/**
 * @file double-booking-test.js
 * @description Prueba de doble-booking — 20 VUs concurrentes sobre la misma habitación
 * y rango de fechas fijos.
 *
 * MÉTRICA        : Tasa de doble-booking
 * DEFINICIÓN     : Reservas confirmadas duplicadas para la misma habitación y rango de fechas.
 * UMBRAL MVP     : 0 casos con 20 usuarios simultáneos.
 * CÓMO MEDIRLO   : Contador k6 `double_booking_reservations_confirmed` debe ser < 2
 *                  al finalizar la prueba.
 *
 *  FLUJO POR VU
 *  ───────────────────────────────────────────────────────────────────────────
 *  1. setup()  → consulta disponibilidad para FIXED_CHECKIN/FIXED_CHECKOUT y
 *               fija una habitación objetivo (todos los VUs compiten por ésta).
 *  2. VU       → intenta crear un hold sobre esa habitación.
 *               · Si recibe 201 → hold creado; procesa pago.
 *               · Si recibe 409/400 → hold rechazado (resultado correcto bajo
 *                 concurrencia); la iteración termina aquí.
 *  3. VU       → paga el hold obtenido.
 *               · Si pago=SUCCESS → verifica que el hold queda CONFIRMED y
 *                 que la habitación desaparece de disponibilidad.
 *               · Si pago=DECLINED → no incrementa el contador.
 *  4. teardown() → imprime instrucción SQL de verificación post-test.
 *
 *  THRESHOLDS CLAVE
 *  ───────────────────────────────────────────────────────────────────────────
 *  double_booking_reservations_confirmed < 2  → solo 0 o 1 reserva confirmada
 *  double_booking_holds_created          < 2  → solo 0 o 1 hold creado (201)
 *
 * Ejecución:
 *   k6 run tests/double-booking-test.js
 *   k6 run -e K6_ENV=qa -e QA_BASE_URL=http://qa.hotel.internal/api/v1 tests/double-booking-test.js
 */

import { Counter } from 'k6/metrics';
import { group, sleep } from 'k6';
import http from 'k6/http';
import { HotelApiClient } from '../clients/hotel-api-client.js';
import { assertResponse, safeParseBody, generateIdempotencyKey } from '../helpers/error-handler.js';
import { BASE_THRESHOLDS, DOUBLE_BOOKING_THRESHOLDS } from '../config/thresholds.js';

// ── Slot fijo: TODOS los VUs compiten por la misma habitación y fechas ────────
// Rango fuera del pool de date-ranges.json para no interferir con otros tests.
const FIXED_CHECKIN  = '2027-12-01';
const FIXED_CHECKOUT = '2027-12-04';

// ── Métricas custom ──────────────────────────────────────────────────────────
/**
 * Cuántos holds recibieron 201 para el slot fijo.
 * Si es >= 2 el sistema no está protegiendo el inventario atómicamente.
 */
const holdsCreated = new Counter('double_booking_holds_created');

/**
 * Cuántas reservas quedaron CONFIRMED para el slot fijo.
 * Si es >= 2 hay doble-booking: el mismo slot fue vendido dos veces.
 */
const reservationsConfirmed = new Counter('double_booking_reservations_confirmed');

// 400/402/409 son error-paths intencionales; no deben contar como http_req_failed.
http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 299 }, 400, 402, 409)
);

// ── Opciones del test ────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    /**
     * 20 VUs concurrentes (ramp-up corto para maximizar la ventana de colisión).
     * El plateau de 1 minuto asegura múltiples rondas de intentos por VU.
     */
    concurrent_booking_attempt: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 20 },  // ramp-up agresivo → maximiza colisiones
        { duration: '1m',  target: 20 },  // plateau: 20 VUs sostenidos
        { duration: '10s', target: 0  },  // ramp-down
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    ...BASE_THRESHOLDS,
    ...DOUBLE_BOOKING_THRESHOLDS,
  },
};

// ── Setup ────────────────────────────────────────────────────────────────────
/**
 * Se ejecuta una sola vez antes de arrancar los VUs.
 * Identifica la habitación objetivo y la comparte (read-only) con todos los VUs.
 */
export function setup() {
  const client = new HotelApiClient();
  const availResponse = client.getAvailableRooms(FIXED_CHECKIN, FIXED_CHECKOUT);
  const rooms = safeParseBody(availResponse.body);

  if (!Array.isArray(rooms) || rooms.length === 0) {
    console.error(
      `[DoubleBooking][setup] Sin habitaciones disponibles para ` +
      `${FIXED_CHECKIN}/${FIXED_CHECKOUT}. ` +
      `Verifica que el backend tiene datos para ese rango.`
    );
    return { roomId: null, price: 80 };
  }

  const target = rooms[0];
  console.log(
    `[DoubleBooking][setup] Habitación objetivo fijada: id=${target.id} | ` +
    `precio=${target.price_per_night} | ` +
    `${rooms.length} habitación(es) disponibles inicialmente`
  );

  return {
    roomId: target.id,
    price:  parseFloat(target.price_per_night) || 80,
  };
}

// ── VU function ──────────────────────────────────────────────────────────────
export default function (data) {
  const { roomId, price } = data;

  if (!roomId) {
    // El setup no encontró disponibilidad; no hay nada que probar.
    console.warn('[DoubleBooking] Sin roomId — iteración omitida (setup falló)');
    return;
  }

  const client = new HotelApiClient();

  // ── Paso 1: Intentar hold sobre el slot fijo ─────────────────────────────
  group('DoubleBooking | Paso 1 - Intentar hold', () => {
    const holdResponse = client.createHold(roomId, FIXED_CHECKIN, FIXED_CHECKOUT);
    const holdBody = safeParseBody(holdResponse.body);

    // El sistema debe responder con 201 (éxito) o 409/400 (slot ya tomado).
    // Cualquier otro status es un fallo no esperado.
    assertResponse(
      holdResponse,
      {
        'DoubleBooking | POST hold retorna 201, 409 o 400': (r) =>
          r.status === 201 || r.status === 409 || r.status === 400,
      },
      'doubleBooking:hold'
    );

    const holdCreated = holdResponse.status === 201 && holdBody && holdBody.id;

    if (!holdCreated) {
      // 409/400 → el sistema bloqueó correctamente el segundo intento.
      sleep(0.3);
      return;
    }

    // Solo el VU que obtiene un 201 llega hasta aquí.
    holdsCreated.add(1);
    sleep(0.3);

    // ── Paso 2: Procesar pago ──────────────────────────────────────────────
    group('DoubleBooking | Paso 2 - Pagar hold', () => {
      const idempotencyKey = generateIdempotencyKey();
      const payResponse    = client.processPayment(holdBody.id, price, idempotencyKey);
      const payBody        = safeParseBody(payResponse.body);

      assertResponse(
        payResponse,
        {
          'DoubleBooking | POST pago retorna 200 o 402': (r) =>
            r.status === 200 || r.status === 402,
        },
        'doubleBooking:payment'
      );

      const paymentStatus = payBody ? payBody.status : null;
      sleep(0.3);

      if (paymentStatus !== 'SUCCESS') {
        return;
      }

      // ── Paso 3: Verificar hold CONFIRMED ────────────────────────────────
      group('DoubleBooking | Paso 3 - Verificar confirmación', () => {
        const holdCheckResponse = client.getHold(holdBody.id);
        const holdCheck         = safeParseBody(holdCheckResponse.body);

        const isConfirmed =
          holdCheck &&
          holdCheck.status === 'CONFIRMED' &&
          holdCheck.reservation_id;

        assertResponse(
          holdCheckResponse,
          {
            'DoubleBooking | hold queda CONFIRMED tras pago SUCCESS': () =>
              isConfirmed,
            'DoubleBooking | hold CONFIRMED tiene reservation_id': () =>
              holdCheck && typeof holdCheck.reservation_id === 'string',
          },
          'doubleBooking:verify-confirmed'
        );

        if (isConfirmed) {
          // Incrementar el contador de reservas confirmadas para el slot fijo.
          // UMBRAL MVP: este contador debe terminar en < 2.
          reservationsConfirmed.add(1);
        }

        sleep(0.3);

        // ── Paso 4: Verificar que el slot ya no aparece disponible ────────
        group('DoubleBooking | Paso 4 - Disponibilidad post-confirmación', () => {
          const availAfterResponse = client.getAvailableRooms(FIXED_CHECKIN, FIXED_CHECKOUT);
          const roomsAfter         = safeParseBody(availAfterResponse.body);

          const roomStillAvailable =
            Array.isArray(roomsAfter) && roomsAfter.some((r) => r.id === roomId);

          // TC-HU6-03: la habitación confirmada no debe volver a aparecer.
          // Si aparece, otro VU podría intentar holdearla → riesgo de doble-booking.
          assertResponse(
            availAfterResponse,
            {
              'DoubleBooking | habitación confirmada NO aparece en disponibilidad': () =>
                !roomStillAvailable,
            },
            'doubleBooking:availability-after'
          );
        });
      });
    });
  });

  sleep(1);
}

// ── Teardown ─────────────────────────────────────────────────────────────────
/**
 * Se ejecuta una sola vez después de que todos los VUs terminan.
 * Imprime la consulta SQL de verificación post-test para diagnóstico manual.
 */
export function teardown(data) {
  console.log(
    '\n[DoubleBooking][teardown] Prueba completada.\n' +
    `  Habitación objetivo : ${data.roomId}\n` +
    `  Rango de fechas     : ${FIXED_CHECKIN} → ${FIXED_CHECKOUT}\n` +
    '\n' +
    '  Verificación SQL post-test (ejecutar contra la DB del backend):\n' +
    '  ──────────────────────────────────────────────────────────────\n' +
    '  SELECT room_id, checkin, checkout, COUNT(*) AS total\n' +
    '  FROM   reservations\n' +
    "  WHERE  status = 'CONFIRMED'\n" +
    '  GROUP  BY room_id, checkin, checkout\n' +
    '  HAVING COUNT(*) > 1;\n' +
    '\n' +
    '  Si esta query retorna filas → hay doble-booking en base de datos.\n' +
    '  Si retorna vacío          → sin doble-booking (MVP pass).\n'
  );
}
