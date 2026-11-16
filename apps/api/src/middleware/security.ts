import { timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { AppDatabase } from '../db/client.js';
import { merchants } from '../db/schema.js';

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
}

function resolveMaxRequests(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const envVal = Number(process.env.RATE_LIMIT_MAX);
  if (Number.isFinite(envVal) && envVal > 0) {
    return Math.floor(envVal);
  }
  return 120;
}

/**
 * Sliding-window in-memory rate limiter keyed by client IP.
 * Defaults to 120 requests per minute, configurable via RATE_LIMIT_MAX.
 */
export function rateLimiter(options: RateLimiterOptions = {}): MiddlewareHandler {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = resolveMaxRequests(options.maxRequests);
  const hits = new Map<string, number[]>();

  return async (c, next) => {
    const forwardedFor = c.req.header('x-forwarded-for');
    const ip =
      forwardedFor?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip')?.trim() ||
      'unknown';

    const now = Date.now();
    const windowStart = now - windowMs;
    const existing = hits.get(ip) ?? [];
    const recent = existing.filter((ts) => ts > windowStart);

    if (recent.length >= maxRequests) {
      const oldest = recent[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      hits.set(ip, recent);
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({ error: 'Too many requests, please try again later' }, 429);
    }

    recent.push(now);
    hits.set(ip, recent);

    if (hits.size > 10_000) {
      for (const [key, timestamps] of hits) {
        if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= windowStart) {
          hits.delete(key);
        }
      }
    }

    await next();
  };
}

function extractApiKey(c: Parameters<MiddlewareHandler>[0]): string | null {
  const headerKey = c.req.header('x-api-key')?.trim();
  if (headerKey) return headerKey;

  const authHeader = c.req.header('authorization')?.trim();
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return null;
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies X-Api-Key or Authorization: Bearer <key> against active merchants
 * when process.env.REQUIRE_API_KEY === 'true'.
 */
export function apiKeyAuth(db: AppDatabase): MiddlewareHandler {
  return async (c, next) => {
    if (process.env.REQUIRE_API_KEY !== 'true') {
      await next();
      return;
    }

    const providedKey = extractApiKey(c);
    if (!providedKey) {
      return c.json({ error: 'Unauthorized: missing API key' }, 401);
    }

    const [merchant] = await db
      .select({ id: merchants.id, apiKey: merchants.apiKey })
      .from(merchants)
      .where(and(eq(merchants.apiKey, providedKey), eq(merchants.isActive, 1)))
      .limit(1);

    if (!merchant || !safeEqualStrings(merchant.apiKey, providedKey)) {
      return c.json({ error: 'Unauthorized: invalid API key' }, 401);
    }

    await next();
  };
}
