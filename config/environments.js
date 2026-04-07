/**
 * @module environments
 * @description Centraliza URLs base y configuraciones por entorno.
 * Selecciona el entorno mediante la variable de entorno K6_ENV.
 * Uso: k6 run -e K6_ENV=qa tests/smoke-test.js
 */

const ENVIRONMENTS = {
  local: {
    baseUrl: 'http://localhost:3000/api/v1',
    label: 'Local',
  },
  qa: {
    baseUrl: __ENV.QA_BASE_URL || 'http://localhost:3000/api/v1',
    label: 'QA',
  },
  staging: {
    baseUrl: __ENV.STAGING_BASE_URL || 'http://localhost:3000/api/v1',
    label: 'Staging',
  },
};

const activeEnvKey = __ENV.K6_ENV || 'local';

if (!ENVIRONMENTS[activeEnvKey]) {
  throw new Error(`Entorno desconocido: "${activeEnvKey}". Valores válidos: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

export const ENV = ENVIRONMENTS[activeEnvKey];
export const BASE_URL = ENV.baseUrl;
