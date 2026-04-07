/**
 * @file smoke-test.js
 * @description Smoke Test — carga mínima (1 VU).
 *
 * PROPÓSITO: verificar que los scripts funcionan sin errores de lógica y que
 * el sistema levantado responde correctamente antes de escalar la carga.
 *
 * CTs cubiertos en este archivo:
 *  TC-HU2-01  Disponibilidad happy path
 *  TC-HU2-07  Disponibilidad → respuesta vacía es válida
 *  TC-HU3-01  Crear hold happy path
 *  TC-HU3-03  Segundo hold sobre habitación ya bloqueada → rechazo
 *  TC-HU6-01  Confirmación tras pago SUCCESS
 *  TC-HU6-02  No confirmación tras pago DECLINED
 *  TC-HU6-03  Habitación confirmada no aparece en disponibilidad
 *  TC-HU11-01 Fechas inválidas: checkout < checkin
 *  TC-HU11-02 Fechas inválidas: misma fecha
 *  TC-HU11-03 Fechas inválidas: en el pasado
 *  TC-HU11-04 Fechas válidas: hold creado
 *
 * Ejecución:
 *   k6 run tests/smoke-test.js
 *   k6 run -e K6_ENV=qa tests/smoke-test.js
 */

import { group, sleep } from 'k6';
import http from 'k6/http';
import { BASE_THRESHOLDS } from '../config/thresholds.js';
import { SMOKE_WORKLOAD } from '../config/workloads.js';
import { HotelApiClient } from '../clients/hotel-api-client.js';

// Declara los códigos HTTP esperados en este test.
// 400/402/409 son respuestas válidas de los error-path TCs y NO deben
// incrementar http_req_failed. Solo los 5xx y conexiones rotas son fallos reales.
http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 299 }, 400, 402, 409)
);
import { searchAvailability } from '../scenarios/availability-scenario.js';
import { createHoldHappyPath, createHoldOnBlockedRoom } from '../scenarios/hold-scenario.js';
import { processPayment } from '../scenarios/payment-scenario.js';
import { verifyConfirmedReservation, verifyHoldNotConfirmedAfterDecline } from '../scenarios/reservation-scenario.js';
import {
  holdWithCheckoutBeforeCheckin,
  holdWithSameDate,
  holdWithPastDates,
  holdWithValidDates,
} from '../scenarios/date-validation-scenario.js';
import { safeParseBody, generateIdempotencyKey } from '../helpers/error-handler.js';

// Leído en contexto init (una vez, no en VU)
const DATE_RANGES = JSON.parse(open('../data/date-ranges.json'));

export const options = {
  scenarios: {
    smoke: SMOKE_WORKLOAD,
  },
  thresholds: {
    ...BASE_THRESHOLDS,
  },
};

// ── Setup: sólo verifica conectividad ─────────────────────────────────────────
export function setup() {
  const client = new HotelApiClient();
  const response = client.getAvailableRooms('2026-10-01', '2026-10-03');

  if (response.status === 0) {
    throw new Error('[setup] API no disponible. Verifica que el backend esté corriendo.');
  }

  console.log(`[setup] Conectividad OK — status ${response.status}`);
  return {};
}

// ── VU function ────────────────────────────────────────────────────────────────
// Cada iteración usa un rango de fechas distinto para no reutilizar
// el mismo room/fechas y provocar 409 en cascada.
export default function () {
  const client = new HotelApiClient();

  // Rango principal para esta iteración (rota por índice de iteración)
  const mainRange = DATE_RANGES[__ITER % DATE_RANGES.length];
  const { checkin, checkout } = mainRange;

  // Rango desplazado para HU11-04: evita colisionar con el flujo principal
  const hu11Range = DATE_RANGES[(__ITER + 4) % DATE_RANGES.length];

  // ── HU2: Disponibilidad ──────────────────────────────────────────────────────
  group('HU2 - Consulta de Disponibilidad', () => {
    searchAvailability(checkin, checkout);
  });

  sleep(1);

  // ── HU11: Validación de fechas ───────────────────────────────────────────────
  // TC-HU11-01/02/03: la validación de fechas ocurre antes del check de disponibilidad
  // en el backend, así que cualquier roomId sirve. Se consulta disponibilidad con
  // el rango HU11 para obtener un ID válido y luego crear el hold de TC-HU11-04.
  group('HU11 - Validación de Integridad de Fechas', () => {
    const availRes = client.getAvailableRooms(hu11Range.checkin, hu11Range.checkout);
    const hu11Rooms = safeParseBody(availRes.body);

    if (!Array.isArray(hu11Rooms) || hu11Rooms.length === 0) {
      console.warn('[HU11] Sin habitaciones disponibles para el rango de validación. TCs omitidos.');
      return;
    }

    const hu11RoomId = hu11Rooms[0].id;

    holdWithCheckoutBeforeCheckin(hu11RoomId);              // TC-HU11-01
    holdWithSameDate(hu11RoomId);                           // TC-HU11-02
    holdWithPastDates(hu11RoomId);                          // TC-HU11-03
    holdWithValidDates(hu11RoomId, hu11Range.checkin, hu11Range.checkout); // TC-HU11-04
  });

  sleep(1);

  // ── HU3 + HU6: Hold → Pago → Confirmación ───────────────────────────────────
  // Se consulta disponibilidad fresca para obtener un room disponible
  // en el rango principal de esta iteración.
  group('HU3 + HU6 - Hold y Confirmación', () => {
    const availRes = client.getAvailableRooms(checkin, checkout);
    const rooms = safeParseBody(availRes.body);

    if (!Array.isArray(rooms) || rooms.length === 0) {
      console.warn(`[HU3] Sin habitaciones disponibles para ${checkin}/${checkout}. TCs omitidos.`);
      return;
    }

    const room = rooms[0];
    const pricePerNight = parseFloat(room.price_per_night) || 80;

    // TC-HU3-01: crear hold
    const { holdId } = createHoldHappyPath(room.id, checkin, checkout);
    if (!holdId) return;

    sleep(0.5);

    // TC-HU3-03: segundo hold sobre habitación bloqueada
    createHoldOnBlockedRoom(room.id, checkin, checkout);

    sleep(0.5);

    // TC-HU6-01 / TC-HU6-02: pago
    const key = generateIdempotencyKey();
    const { status: payStatus } = processPayment(holdId, pricePerNight, key);

    sleep(0.5);

    if (payStatus === 'SUCCESS') {
      verifyConfirmedReservation(holdId, checkin, checkout);
    } else if (payStatus === 'DECLINED') {
      verifyHoldNotConfirmedAfterDecline(holdId);
    }
  });

  sleep(2);
}
