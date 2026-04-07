/**
 * @file stress-test.js
 * @description Stress Test — carga por encima de producción para encontrar el límite.
 *
 * PROPÓSITO: determinar hasta qué punto el sistema se degrada bajo carga extrema
 * y confirmar que los errores son manejados con gracia (sin 5xx inesperados).
 *
 * Enfoque principal: flujo completo de reserva + consultas de disponibilidad
 * bajo alta concurrencia.
 *
 * Nota sobre TC-HU3-02 (concurrencia de hold):
 *  El test de concurrencia que más se acerca está implementado aquí mediante
 *  múltiples VUs lanzando holds sobre habitaciones distintas del pool.
 *  La restricción de concurrencia exacta sobre LA MISMA habitación sigue
 *  siendo "No activo" por las razones indicadas en la matriz, pero el
 *  comportamiento bajo alta concurrencia del sistema completo SÍ se evalúa.
 *
 * Ejecución:
 *   k6 run tests/stress-test.js
 *   k6 run -e K6_ENV=qa tests/stress-test.js
 */

import { group, sleep } from 'k6';
import {
  BASE_THRESHOLDS,
  HOLD_THRESHOLDS,
  AVAILABILITY_THRESHOLDS,
  PAYMENT_THRESHOLDS,
} from '../config/thresholds.js';
import { completeBookingFlow } from '../scenarios/booking-flow-scenario.js';
import { searchAvailability } from '../scenarios/availability-scenario.js';
import { safeParseBody } from '../helpers/error-handler.js';
import { HotelApiClient } from '../clients/hotel-api-client.js';

const DATE_RANGES = JSON.parse(open('../data/date-ranges.json'));

export const options = {
  scenarios: {
    // Flujo completo bajo estrés
    booking_stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 10 },
        { duration: '3m', target: 30 },
        { duration: '5m', target: 50 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '60s',
      exec: 'bookingStressVu',
    },
    // Disponibilidad bajo estrés
    availability_stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 15 },
        { duration: '5m', target: 40 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'availabilityStressVu',
    },
  },
  thresholds: {
    // En stress los umbrales son más permisivos que en load
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    http_req_failed: ['rate<0.05'],
    checks: ['rate>=0.85'],
    ...HOLD_THRESHOLDS,
    ...AVAILABILITY_THRESHOLDS,
    ...PAYMENT_THRESHOLDS,
  },
};

export function setup() {
  const client = new HotelApiClient();
  const response = client.getAvailableRooms('2026-10-01', '2026-10-03');
  const rooms = safeParseBody(response.body);

  if (!Array.isArray(rooms) || rooms.length === 0) {
    console.warn('[setup] Sin habitaciones disponibles para stress test.');
    return { hasRooms: false };
  }

  return { hasRooms: true };
}

export function bookingStressVu(data) {
  if (!data.hasRooms) {
    sleep(2);
    return;
  }

  const range = DATE_RANGES[Math.floor(Math.random() * DATE_RANGES.length)];

  group('StressTest - Flujo Completo', () => {
    completeBookingFlow(range.checkin, range.checkout);
  });

  // Think time reducido en stress para generar más presión
  sleep(0.5);
}

export function availabilityStressVu() {
  const range = DATE_RANGES[Math.floor(Math.random() * DATE_RANGES.length)];

  group('StressTest - Disponibilidad', () => {
    searchAvailability(range.checkin, range.checkout);
  });

  sleep(0.3);
}

export default function (data) {
  bookingStressVu(data);
}
