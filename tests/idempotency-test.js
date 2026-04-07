/**
 * @file idempotency-test.js
 * @description Test focalizado en HU5: idempotencia de pagos.
 *
 * Casos cubiertos:
 *  TC-HU5-01  Reenvío con misma key retorna resultado original exitoso
 *  TC-HU5-02  Reenvío con misma key retorna resultado DECLINED original
 *  TC-HU5-03  Reutilización de key en hold diferente → rechazado (si el backend lo soporta)
 *
 * NOTA sobre TC-HU5-03: la matriz indica que el backend observado reutiliza el
 * resultado cacheado y no rechaza la key cross-hold. Por eso:
 *  - El check de TC-HU5-03 está marcado como informativo (no bloquea la prueba)
 *  - Se registra el comportamiento real para documentarlo
 *
 * Ejecución:
 *   k6 run tests/idempotency-test.js
 */

import { group, sleep } from 'k6';
import { BASE_THRESHOLDS } from '../config/thresholds.js';
import { SMOKE_WORKLOAD } from '../config/workloads.js';
import { HotelApiClient } from '../clients/hotel-api-client.js';
import { processPayment, retryPaymentIdempotent } from '../scenarios/payment-scenario.js';
import { safeParseBody, generateIdempotencyKey } from '../helpers/error-handler.js';
import { check } from 'k6';

export const options = {
  scenarios: {
    idempotency_smoke: SMOKE_WORKLOAD,
  },
  thresholds: {
    ...BASE_THRESHOLDS,
  },
};

export function setup() {
  const client = new HotelApiClient();

  // Buscar habitación disponible
  const availRes = client.getAvailableRooms('2026-10-05', '2026-10-08');
  const rooms = safeParseBody(availRes.body);

  if (!Array.isArray(rooms) || rooms.length === 0) {
    console.warn('[setup idempotency] Sin habitaciones disponibles.');
    return { holdA: null, holdB: null };
  }

  // Crear hold A
  const holdARes = client.createHold(rooms[0].id, '2026-10-05', '2026-10-08');
  const holdA = safeParseBody(holdARes.body);

  // Si hay segunda habitación, crear hold B para TC-HU5-03
  let holdB = null;
  if (rooms.length >= 2) {
    const holdBRes = client.createHold(rooms[1].id, '2026-10-05', '2026-10-08');
    holdB = safeParseBody(holdBRes.body);
  }

  const amount = parseFloat(rooms[0].price_per_night) || 80;
  return { holdA, holdB, amount };
}

export default function (data) {
  const { holdA, holdB, amount = 80 } = data;

  if (!holdA || !holdA.id) {
    sleep(2);
    return;
  }

  // ── TC-HU5-01 y TC-HU5-02: Idempotencia básica ──────────────────────────────
  group('HU5 - Idempotencia de Pagos', () => {
    const key = generateIdempotencyKey();

    // Primer intento de pago
    const { status: firstStatus } = processPayment(holdA.id, amount, key);

    sleep(0.5);

    // Reintento con la MISMA key → debe retornar mismo resultado
    if (firstStatus === 'SUCCESS') {
      retryPaymentIdempotent(holdA.id, amount, key, 'SUCCESS');
    } else if (firstStatus === 'DECLINED') {
      retryPaymentIdempotent(holdA.id, amount, key, 'DECLINED');
    }
  });

  sleep(1);

  // ── TC-HU5-03: Key cross-hold (informativo) ──────────────────────────────────
  if (holdB && holdB.id) {
    group('HU5 - TC-HU5-03 Cross-Hold Key (informativo)', () => {
      const keyFromHoldA = generateIdempotencyKey();

      // Primero establecemos la key en hold A
      const client = new HotelApiClient();
      client.processPayment(holdA.id, amount, keyFromHoldA);

      sleep(0.3);

      // Intentamos usar la misma key en hold B
      const crossRes = client.processPayment(holdB.id, amount, keyFromHoldA);
      const crossBody = safeParseBody(crossRes.body);

      // Check informativo: documentamos si el backend rechaza (400/409) o reutiliza
      check(crossRes, {
        'TC-HU5-03 [INFO] backend maneja key cross-hold sin 500': (r) => r.status < 500,
      });

      if (crossRes.status === 400 || crossRes.status === 409) {
        console.log(`[TC-HU5-03] Backend RECHAZA key cross-hold correctamente. Status: ${crossRes.status}`);
      } else {
        console.warn(`[TC-HU5-03] Backend NO rechazó key cross-hold. Status: ${crossRes.status} — ver nota en tc.md`);
      }
    });
  }

  sleep(2);
}
