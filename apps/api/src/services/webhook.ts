import { randomUUID } from 'node:crypto';
import { signWebhookPayload } from '@qris-dinamis/core';
import { and, eq, lte } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { merchants, webhookLogs, type MerchantRow, type TransactionRow, type WebhookLogRow } from '../db/schema.js';

export type WebhookEventType = 'payment.paid' | 'payment.expired' | 'payment.cancelled' | 'payment.refunded';

const RETRY_BACKOFF_SECONDS = [30, 120, 600, 1800, 3600];

/**
 * Checks whether a webhook target URL points to a private/loopback/metadata IP
 * when SSRF protection is active (NODE_ENV=production or ALLOW_PRIVATE_WEBHOOKS=false).
 */
export function isBlockedWebhookUrl(targetUrl: string): string | null {
  const allowPrivate =
    process.env.ALLOW_PRIVATE_WEBHOOKS === 'true'
      ? true
      : process.env.ALLOW_PRIVATE_WEBHOOKS === 'false'
        ? false
        : process.env.NODE_ENV !== 'production';

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return 'Invalid webhook URL';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Blocked webhook protocol: ${parsed.protocol}`;
  }

  if (allowPrivate) return null;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return `SSRF blocked: private or loopback webhook host "${host}" is not allowed`;
  }

  return null;
}

export function buildWebhookBody(eventType: WebhookEventType, tx: TransactionRow) {
  return {
    id: `evt_${randomUUID()}`,
    type: eventType,
    createdAt: new Date().toISOString(),
    data: {
      transactionId: tx.id,
      merchantId: tx.merchantId,
      externalId: tx.externalId,
      baseAmount: tx.baseAmount,
      uniqueCode: tx.uniqueCode,
      totalAmount: tx.totalAmount,
      status: tx.status,
      paidVia: tx.paidVia,
      paidReference: tx.paidReference,
      paidAt: tx.paidAt,
      expiresAt: tx.expiresAt,
      metadata: tx.metadataJson ? JSON.parse(tx.metadataJson) : null,
    },
  };
}

async function attemptDelivery(
  db: AppDatabase,
  log: WebhookLogRow,
  secret: string,
): Promise<WebhookLogRow> {
  const now = new Date();
  const timestamp = Math.floor(now.getTime() / 1000);
  const signature = signWebhookPayload({
    secret,
    timestamp,
    rawBody: log.payloadJson,
  });

  const nextAttemptCount = log.attemptCount + 1;
  let httpStatus: number | null = null;
  let responseBody: string | null = null;
  let delivered = false;

  const ssrfError = isBlockedWebhookUrl(log.targetUrl);
  if (ssrfError) {
    responseBody = ssrfError;
  } else {
    try {
      const res = await fetch(log.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'QrisDinamis-Webhook/2.1',
          'X-Qris-Event': log.eventType,
          'X-Qris-Delivery-Id': log.id,
          'X-Qris-Signature': signature,
        },
        body: log.payloadJson,
        signal: AbortSignal.timeout(Number(process.env.WEBHOOK_TIMEOUT_MS ?? 8000)),
      });
      httpStatus = res.status;
      responseBody = (await res.text()).slice(0, 1000);
      delivered = res.ok;
    } catch (err) {
      responseBody = err instanceof Error ? err.message : 'Network error';
    }
  }

  const isExhausted = !delivered && nextAttemptCount >= log.maxAttempts;
  const status = delivered ? 'DELIVERED' : isExhausted ? 'FAILED' : 'PENDING';
  const backoffSec = RETRY_BACKOFF_SECONDS[Math.min(nextAttemptCount - 1, RETRY_BACKOFF_SECONDS.length - 1)];
  const nextRetryAt =
    status === 'PENDING' ? new Date(now.getTime() + backoffSec * 1000).toISOString() : null;

  const [updated] = await db
    .update(webhookLogs)
    .set({
      signature,
      attemptCount: nextAttemptCount,
      httpStatus,
      responseBody,
      status,
      nextRetryAt,
      lastAttemptAt: now.toISOString(),
    })
    .where(eq(webhookLogs.id, log.id))
    .returning();

  return updated;
}

export async function dispatchWebhook(
  db: AppDatabase,
  tx: TransactionRow,
  merchant: MerchantRow,
  eventType: WebhookEventType,
): Promise<WebhookLogRow | null> {
  if (!merchant.webhookUrl) {
    return null;
  }

  const now = new Date().toISOString();
  const payloadJson = JSON.stringify(buildWebhookBody(eventType, tx));
  const initialSig = signWebhookPayload({
    secret: merchant.webhookSecret,
    timestamp: Math.floor(Date.now() / 1000),
    rawBody: payloadJson,
  });

  const [log] = await db
    .insert(webhookLogs)
    .values({
      id: `wh_${randomUUID()}`,
      transactionId: tx.id,
      merchantId: merchant.id,
      eventType,
      targetUrl: merchant.webhookUrl,
      payloadJson,
      signature: initialSig,
      attemptCount: 0,
      maxAttempts: Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 5),
      status: 'PENDING',
      createdAt: now,
    })
    .returning();

  return attemptDelivery(db, log, merchant.webhookSecret);
}

export async function retryWebhookById(db: AppDatabase, logId: string): Promise<WebhookLogRow | null> {
  const [log] = await db.select().from(webhookLogs).where(eq(webhookLogs.id, logId));
  if (!log) return null;

  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, log.merchantId));
  if (!merchant) return null;

  return attemptDelivery(db, log, merchant.webhookSecret);
}

export async function processDueWebhookRetries(db: AppDatabase): Promise<number> {
  const nowIso = new Date().toISOString();
  const dueLogs = await db
    .select()
    .from(webhookLogs)
    .where(and(eq(webhookLogs.status, 'PENDING'), lte(webhookLogs.nextRetryAt, nowIso)));

  let processed = 0;
  for (const log of dueLogs) {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, log.merchantId));
    if (merchant) {
      await attemptDelivery(db, log, merchant.webhookSecret);
      processed++;
    }
  }
  return processed;
}

/**
 * Replays all FAILED webhook deliveries (Dead-Letter Queue), optionally scoped to a merchant.
 */
export async function retryFailedWebhooks(db: AppDatabase, merchantId?: string): Promise<number> {
  const failedLogs = merchantId
    ? await db
        .select()
        .from(webhookLogs)
        .where(and(eq(webhookLogs.status, 'FAILED'), eq(webhookLogs.merchantId, merchantId)))
    : await db.select().from(webhookLogs).where(eq(webhookLogs.status, 'FAILED'));

  let retried = 0;
  for (const log of failedLogs) {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, log.merchantId));
    if (merchant) {
      await attemptDelivery(db, log, merchant.webhookSecret);
      retried++;
    }
  }
  return retried;
}
