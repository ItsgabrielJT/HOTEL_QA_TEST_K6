/**
 * @module error-handler
 * @description Wrapper centralizado para manejo de errores y aserciones.
 * Registra contexto detallado cuando un check falla en lugar de fallar
 * silenciosamente. Aplica principio SRP: un solo lugar para tratar errores.
 */

import { check } from 'k6';

/**
 * Ejecuta un conjunto de checks sobre una respuesta HTTP y registra
 * información de diagnóstico si alguno falla.
 *
 * @param {import('k6/http').Response} response - Respuesta HTTP de k6
 * @param {Object} assertions - Mapa { label: fn(response) => boolean }
 * @param {string} context - Nombre del endpoint o flujo para el log
 * @returns {boolean} true si todos los checks pasaron
 */
export function assertResponse(response, assertions, context = 'unknown') {
  const allPassed = check(response, assertions);

  if (!allPassed) {
    const failedLabels = Object.entries(assertions)
      .filter(([, fn]) => !fn(response))
      .map(([label]) => label);

    console.error(
      JSON.stringify({
        context,
        url: response.url,
        status: response.status,
        failed_checks: failedLabels,
        response_body: safeParseBody(response.body),
        timestamp: new Date().toISOString(),
      })
    );
  }

  return allPassed;
}

/**
 * Parsea el body de una respuesta de forma segura.
 * Si no es JSON válido retorna el string crudo (truncado a 500 chars).
 *
 * @param {string} body
 * @returns {any}
 */
export function safeParseBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return String(body).substring(0, 500);
  }
}

/**
 * Valida que una respuesta contiene un campo específico con el valor esperado.
 * Útil para construir assertions reutilizables.
 *
 * @param {string} field - Nombre del campo en el JSON de respuesta
 * @param {any} expectedValue - Valor esperado
 * @returns {Function} función compatible con check() de k6
 */
export function hasField(field, expectedValue) {
  return (res) => {
    const body = safeParseBody(res.body);
    if (!body || typeof body !== 'object') return false;
    return body[field] === expectedValue;
  };
}

/**
 * Genera una clave de idempotencia UUID v4 simple.
 * No usa crypto.getRandomValues (no disponible en k6) sino
 * Math.random, suficiente para pruebas de carga.
 *
 * @returns {string} UUID v4 pseudo-aleatorio
 */
export function generateIdempotencyKey() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
