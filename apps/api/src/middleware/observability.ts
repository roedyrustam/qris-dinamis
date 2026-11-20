import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export interface MetricsRegistry {
  httpRequestsTotal: number;
  httpErrorsTotal: number;
  httpDurationMsSum: number;
  sseActiveConnections: number;
}

export function createMetricsRegistry(): MetricsRegistry {
  return {
    httpRequestsTotal: 0,
    httpErrorsTotal: 0,
    httpDurationMsSum: 0,
    sseActiveConnections: 0,
  };
}

/**
 * Adds X-Request-Id correlation header and collects lightweight HTTP metrics.
 */
export function observabilityMiddleware(metrics: MetricsRegistry): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id')?.trim() || `req_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const start = Date.now();
    c.header('X-Request-Id', requestId);

    await next();

    const durationMs = Date.now() - start;
    metrics.httpRequestsTotal++;
    metrics.httpDurationMsSum += durationMs;
    if (c.res.status >= 500) {
      metrics.httpErrorsTotal++;
    }
  };
}

export function formatPrometheusMetrics(
  metrics: MetricsRegistry,
  txCounts: Record<string, number>,
): string {
  const lines = [
    '# HELP qris_http_requests_total Total HTTP requests handled',
    '# TYPE qris_http_requests_total counter',
    `qris_http_requests_total ${metrics.httpRequestsTotal}`,
    '# HELP qris_http_errors_total Total HTTP 5xx responses',
    '# TYPE qris_http_errors_total counter',
    `qris_http_errors_total ${metrics.httpErrorsTotal}`,
    '# HELP qris_http_request_duration_ms_sum Cumulative HTTP request duration in milliseconds',
    '# TYPE qris_http_request_duration_ms_sum counter',
    `qris_http_request_duration_ms_sum ${metrics.httpDurationMsSum}`,
    '# HELP qris_sse_active_connections Currently open SSE payment event streams',
    '# TYPE qris_sse_active_connections gauge',
    `qris_sse_active_connections ${metrics.sseActiveConnections}`,
    '# HELP qris_transactions_total Transactions grouped by status',
    '# TYPE qris_transactions_total gauge',
  ];

  for (const [status, count] of Object.entries(txCounts)) {
    lines.push(`qris_transactions_total{status="${status}"} ${count}`);
  }

  return `${lines.join('\n')}\n`;
}
