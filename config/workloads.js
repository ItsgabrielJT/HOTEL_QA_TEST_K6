/**
 * @module workloads
 * @description Perfiles de carga reutilizables.
 * Cada workload define stages (ramp-up, plateau, ramp-down) y VUs máximos
 * siguiendo el patrón: incremento → mantenimiento → descenso.
 *
 * Uso: importar el workload deseado y asignarlo a options.scenarios o
 * directamente a options.vus/options.stages.
 */

/**
 * Smoke: carga mínima para verificar que los scripts y el sistema funcionan.
 * 1 VU, duración corta.
 */
export const SMOKE_WORKLOAD = {
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '30s', target: 1 },
    { duration: '1m',  target: 1 },
    { duration: '15s', target: 0 },
  ],
  gracefulRampDown: '10s',
};

/**
 * Average Load: tráfico promedio esperado en producción.
 * Simula carga sostenida normal.
 */
export const AVERAGE_LOAD_WORKLOAD = {
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '2m',  target: 10 },
    { duration: '5m',  target: 10 },
    { duration: '2m',  target: 0  },
  ],
  gracefulRampDown: '30s',
};

/**
 * Stress: supera la carga esperada para encontrar el punto de quiebre.
 */
export const STRESS_WORKLOAD = {
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '2m',  target: 20 },
    { duration: '5m',  target: 50 },
    { duration: '2m',  target: 0  },
  ],
  gracefulRampDown: '60s',
};

/**
 * Spike: ráfaga repentina de tráfico para verificar elasticidad.
 */
export const SPIKE_WORKLOAD = {
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '30s', target: 5  },
    { duration: '30s', target: 50 },
    { duration: '1m',  target: 50 },
    { duration: '30s', target: 5  },
    { duration: '30s', target: 0  },
  ],
  gracefulRampDown: '30s',
};
