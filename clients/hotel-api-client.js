/**
 * @module HotelApiClient
 * @description Cliente centralizado para todos los endpoints del Motor de Reservas.
 *
 * Encapsula URLs, headers y lógica HTTP. Si un endpoint cambia su ruta o
 * requiere nuevos headers, solo se modifica aquí (principio OCP/SRP).
 *
 * Cada método recibe params explícitos y retorna la Response cruda de k6
 * para que la capa de scenario/test pueda hacer sus propios checks.
 */

import http from 'k6/http';
import { BASE_URL } from '../config/environments.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export class HotelApiClient {
  constructor(baseUrl = BASE_URL) {
    this._base = baseUrl;
  }

  // ─────────────────────────────────────────────
  //  Disponibilidad  (HU2)
  // ─────────────────────────────────────────────

  /**
   * TC-HU2-xx: Consulta habitaciones disponibles en un rango de fechas.
   *
   * @param {string} checkin  - YYYY-MM-DD
   * @param {string} checkout - YYYY-MM-DD
   * @returns {import('k6/http').Response}
   */
  getAvailableRooms(checkin, checkout) {
    const url = `${this._base}/rooms/available?checkin=${checkin}&checkout=${checkout}`;
    return http.get(url, {
      headers: JSON_HEADERS,
      tags: { endpoint: 'get_availability' },
    });
  }

  // ─────────────────────────────────────────────
  //  Hold  (HU3)
  // ─────────────────────────────────────────────

  /**
   * TC-HU3-xx: Crea un hold temporal sobre una habitación.
   *
   * @param {string} roomId   - UUID de la habitación
   * @param {string} checkin  - YYYY-MM-DD
   * @param {string} checkout - YYYY-MM-DD
   * @returns {import('k6/http').Response}
   */
  createHold(roomId, checkin, checkout) {
    const url = `${this._base}/rooms/${roomId}/hold`;
    const payload = JSON.stringify({ checkin, checkout });
    return http.post(url, payload, {
      headers: JSON_HEADERS,
      tags: { endpoint: 'create_hold' },
    });
  }

  /**
   * TC-HU3-xx / TC-HU6-xx: Obtiene el estado actual de un hold.
   *
   * @param {string} holdId - UUID del hold
   * @returns {import('k6/http').Response}
   */
  getHold(holdId) {
    const url = `${this._base}/holds/${holdId}`;
    return http.get(url, {
      headers: JSON_HEADERS,
      tags: { endpoint: 'get_hold' },
    });
  }

  // ─────────────────────────────────────────────
  //  Pagos  (HU5 / HU6)
  // ─────────────────────────────────────────────

  /**
   * TC-HU5-xx / TC-HU6-xx: Procesa el pago de un hold.
   *
   * @param {string} holdId          - UUID del hold
   * @param {number} amount          - Monto a cobrar
   * @param {string} idempotencyKey  - Clave única para evitar duplicados
   * @returns {import('k6/http').Response}
   */
  processPayment(holdId, amount, idempotencyKey) {
    const url = `${this._base}/payments`;
    const payload = JSON.stringify({
      hold_id: holdId,
      amount,
      idempotency_key: idempotencyKey,
    });
    return http.post(url, payload, {
      headers: JSON_HEADERS,
      tags: { endpoint: 'process_payment' },
    });
  }

  // ─────────────────────────────────────────────
  //  Reservas  (HU6)
  // ─────────────────────────────────────────────

  /**
   * Consulta una reserva por su ID.
   *
   * @param {string} reservationId - UUID de la reserva
   * @returns {import('k6/http').Response}
   */
  getReservationById(reservationId) {
    const url = `${this._base}/reservations/${reservationId}`;
    return http.get(url, {
      headers: JSON_HEADERS,
      tags: { endpoint: 'get_reservation_by_id' },
    });
  }

  /**
   * Consulta una reserva por código legible.
   *
   * @param {string} reservationCode - Código alfanumérico (ej: "0NPLUSYK")
   * @returns {import('k6/http').Response}
   */
  getReservationByCode(reservationCode) {
    const url = `${this._base}/reservations?reservation_code=${reservationCode}`;
    return http.get(url, {
      headers: JSON_HEADERS,
      tags: { endpoint: 'get_reservation_by_code' },
    });
  }
}
