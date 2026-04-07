/**
 * @file load-test.js
 * @description Average Load Test — tráfico promedio esperado.
 *
 * PROPÓSITO: verificar que el sistema sostendrá la carga normal de producción
 * cumpliendo los SLOs definidos en thresholds.js.
 *
 * Escenarios en paralelo:
 *  booking_flow      → flujo completo de reserva (HU2+HU3+HU5+HU6)
 *  availability_only → sólo consultas de disponibilidad (HU2)
 *  date_validation   → validaciones de fechas inválidas (HU11)
 *  idempotency_check → verificación de idempotencia en pagos (HU5)
 *
 * Ejecución:
 *   k6 run tests/load-test.js
 *   k6 run -e K6_ENV=qa tests/load-test.js
 */

import { group, sleep } from 'k6';
import http from 'k6/http';
import {
  BASE_THRESHOLDS,
  HOLD_THRESHOLDS,
  AVAILABILITY_THRESHOLDS,
  PAYMENT_THRESHOLDS,
} from '../config/thresholds.js';

// 400/402/409 son error-paths intencionales; no deben contar como http_req_failed.
http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 299 }, 400, 402, 409)
);
import { HotelApiClient } from '../clients/hotel-api-client.js';
import { completeBookingFlow } from '../scenarios/booking-flow-scenario.js';
import { searchAvailability } from '../scenarios/availability-scenario.js';
import {
  holdWithCheckoutBeforeCheckin,
  holdWithSameDate,
  holdWithPastDates,
} from '../scenarios/date-validation-scenario.js';
import { processPayment, retryPaymentIdempotent } from '../scenarios/payment-scenario.js';
import { createHoldHappyPath } from '../scenarios/hold-scenario.js';
import { safeParseBody, generateIdempotencyKey } from '../helpers/error-handler.js';

// ── Datos de prueba cíclicos ─────────────────────────────────────────────────
const DATE_RANGES = JSON.parse(open('../data/date-ranges.json'));

export const options = {
  scenarios: {
    // Flujo completo de reserva — carga moderada
    booking_flow: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '2m',  target: 5 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      exec: 'bookingFlowVu',
    },
    // Consultas de disponibilidad — mayor frecuencia
    availability_only: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 8 },
        { duration: '2m',  target: 8 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      exec: 'availabilityVu',
    },
    // Validaciones de fecha
    date_validation: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 3 },
        { duration: '2m',  target: 3 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
      exec: 'dateValidationVu',
    },
  },
  thresholds: {
    ...BASE_THRESHOLDS,
    ...HOLD_THRESHOLDS,
    ...AVAILABILITY_THRESHOLDS,
    ...PAYMENT_THRESHOLDS,
  },
};

// ── Setup ────────────────────────────────────────────────────────────────────
export function setup() {
  const client = new HotelApiClient();
  const response = client.getAvailableRooms('2026-10-01', '2026-10-03');
  const rooms = safeParseBody(response.body);

  if (!Array.isArray(rooms) || rooms.length === 0) {
    console.warn('[setup] Sin habitaciones disponibles. El flujo booking_flow se omitirá.');
    return { roomId: null };
  }

  return {
    roomId: rooms[0].id,
    pricePerNight: parseFloat(rooms[0].price_per_night) || 80,
  };
}

// ── VU functions ─────────────────────────────────────────────────────────────

/**
 * Flujo completo: disponibilidad → hold → pago → verificación.
 * Usa rangos de fechas del pool para generar variación de datos.
 */
export function bookingFlowVu() {
  // Distribuye rangos por VU e iteración para minimizar colisiones entre VUs.
  const idx = ((__VU - 1) * 13 + __ITER) % DATE_RANGES.length;
  const range = DATE_RANGES[idx];

  group('BookingFlow completo', () => {
    completeBookingFlow(range.checkin, range.checkout);
  });

  sleep(1);
}

/**
 * Solo consultas de disponibilidad con diferentes rangos de fecha.
 */
export function availabilityVu() {
  const range = DATE_RANGES[Math.floor(Math.random() * DATE_RANGES.length)];

  group('HU2 - Disponibilidad', () => {
    searchAvailability(range.checkin, range.checkout);
  });

  sleep(1);
}

/**
 * Validaciones de fecha inválidas — bajo carga sostenida.
 */
export function dateValidationVu(data) {
  if (!data.roomId) return;

  group('HU11 - Validación de Fechas', () => {
    holdWithCheckoutBeforeCheckin(data.roomId);
    holdWithSameDate(data.roomId);
    holdWithPastDates(data.roomId);
  });

  sleep(1);
}

// Default export requerido aunque no se use directamente
export default function (data) {
  bookingFlowVu(data);
}
