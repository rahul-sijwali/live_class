/**
 * Prometheus metrics (CLAUDE.md §11).
 *
 * Owns: the registry and the handful of custom series. Request latency comes from a
 * Fastify hook in `app.ts`; realtime connection count is sampled from Hocuspocus.
 */

import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/** Metrics handle. */
export interface Metrics {
  readonly registry: Registry;
  readonly httpDuration: Histogram<'method' | 'route' | 'status'>;
  readonly uploadsFailed: Counter<'code'>;
  readonly realtimeConnections: Gauge;
  readonly realtimeDocuments: Gauge;
}

/**
 * Creates an isolated registry with default process metrics and our custom ones.
 *
 * @returns {Metrics} The metrics handle.
 */
export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  return {
    registry,
    httpDuration: new Histogram({
      name: 'live_class_http_request_duration_seconds',
      help: 'HTTP request latency',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    uploadsFailed: new Counter({
      name: 'live_class_uploads_failed_total',
      help: 'Uploads rejected, by error code',
      labelNames: ['code'],
      registers: [registry],
    }),
    realtimeConnections: new Gauge({
      name: 'live_class_realtime_connections',
      help: 'Open realtime WebSocket connections',
      registers: [registry],
    }),
    realtimeDocuments: new Gauge({
      name: 'live_class_realtime_documents',
      help: 'Realtime documents loaded in memory',
      registers: [registry],
    }),
  };
}
