import { and, eq, gt, lt } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { merchants, transactions, type TransactionRow } from '../db/schema.js';
import { transactionEvents } from './events.js';
import { dispatchWebhook } from './webhook.js';

/**
 * Allocates a collision-free unique code (1..999) for a merchant's base amount
 * among currently active (non-expired PENDING) transactions.
 */
export async function allocateUniqueCode(
  db: AppDatabase,
  merchantId: string,
  baseAmount: number,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const activeTxs = await db
    .select({ totalAmount: transactions.totalAmount })
    .from(transactions)
    .where(
      and(
        eq(transactions.merchantId, merchantId),
        eq(transactions.status, 'PENDING'),
        gt(transactions.expiresAt, nowIso),
      ),
    );

  const usedTotals = new Set(activeTxs.map((t) => t.totalAmount));

  // Try randomized starting offset to spread codes evenly and avoid predictability
  const start = Math.floor(Math.random() * 999) + 1;
  for (let offset = 0; offset < 999; offset++) {
    const code = ((start + offset - 1) % 999) + 1;
    if (!usedTotals.has(baseAmount + code)) {
      return code;
    }
  }

  throw new Error('All 999 unique codes are currently occupied for this amount');
}

/**
 * Atomically transitions a PENDING transaction to PAID and dispatches the payment.paid webhook.
 */
export async function markTransactionPaid(
  db: AppDatabase,
  transactionId: string,
  details: { paidVia: string; paidReference?: string | null },
): Promise<{ transaction: TransactionRow | null; webhookTriggered: boolean }> {
  const nowIso = new Date().toISOString();

  const [updated] = await db
    .update(transactions)
    .set({
      status: 'PAID',
      paidVia: details.paidVia,
      paidReference: details.paidReference ?? null,
      paidAt: nowIso,
      updatedAt: nowIso,
    })
    .where(and(eq(transactions.id, transactionId), eq(transactions.status, 'PENDING')))
    .returning();

  if (!updated) {
    return { transaction: null, webhookTriggered: false };
  }

  transactionEvents.emit({
    transactionId: updated.id,
    merchantId: updated.merchantId,
    status: 'PAID',
    totalAmount: updated.totalAmount,
    paidVia: updated.paidVia,
    paidReference: updated.paidReference,
    paidAt: updated.paidAt,
    expiresAt: updated.expiresAt,
    updatedAt: updated.updatedAt,
  });

  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, updated.merchantId));
  let webhookTriggered = false;

  if (merchant?.webhookUrl) {
    await dispatchWebhook(db, updated, merchant, 'payment.paid');
    webhookTriggered = true;
  }

  return { transaction: updated, webhookTriggered };
}

/**
 * Marks expired PENDING transactions as EXPIRED.
 */
export async function expireStaleTransactions(db: AppDatabase): Promise<number> {
  const nowIso = new Date().toISOString();
  const expired = await db
    .update(transactions)
    .set({ status: 'EXPIRED', updatedAt: nowIso })
    .where(and(eq(transactions.status, 'PENDING'), lt(transactions.expiresAt, nowIso)))
    .returning();

  for (const tx of expired) {
    transactionEvents.emit({
      transactionId: tx.id,
      merchantId: tx.merchantId,
      status: 'EXPIRED',
      totalAmount: tx.totalAmount,
      paidVia: tx.paidVia,
      paidReference: tx.paidReference,
      paidAt: tx.paidAt,
      expiresAt: tx.expiresAt,
      updatedAt: tx.updatedAt,
    });
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, tx.merchantId));
    if (merchant?.webhookUrl) {
      await dispatchWebhook(db, tx, merchant, 'payment.expired');
    }
  }

  return expired.length;
}

/**
 * Atomically cancels a PENDING transaction and dispatches the payment.cancelled webhook.
 */
export async function cancelTransaction(
  db: AppDatabase,
  transactionId: string,
): Promise<{ transaction: TransactionRow | null; webhookTriggered: boolean }> {
  const nowIso = new Date().toISOString();
  const [updated] = await db
    .update(transactions)
    .set({ status: 'CANCELLED', updatedAt: nowIso })
    .where(and(eq(transactions.id, transactionId), eq(transactions.status, 'PENDING')))
    .returning();

  if (!updated) return { transaction: null, webhookTriggered: false };

  transactionEvents.emit({
    transactionId: updated.id,
    merchantId: updated.merchantId,
    status: 'CANCELLED',
    totalAmount: updated.totalAmount,
    expiresAt: updated.expiresAt,
    updatedAt: updated.updatedAt,
  });

  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, updated.merchantId));
  let webhookTriggered = false;
  if (merchant?.webhookUrl) {
    await dispatchWebhook(db, updated, merchant, 'payment.cancelled');
    webhookTriggered = true;
  }

  return { transaction: updated, webhookTriggered };
}

/**
 * Atomically refunds a PAID transaction and dispatches the payment.refunded webhook.
 */
export async function refundTransaction(
  db: AppDatabase,
  transactionId: string,
  reason?: string,
): Promise<{ transaction: TransactionRow | null; webhookTriggered: boolean }> {
  const nowIso = new Date().toISOString();
  const [existing] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
  if (!existing || existing.status !== 'PAID') {
    return { transaction: null, webhookTriggered: false };
  }

  const prevMeta = existing.metadataJson ? (JSON.parse(existing.metadataJson) as Record<string, unknown>) : {};
  const nextMeta = reason ? { ...prevMeta, refundReason: reason, refundedAt: nowIso } : { ...prevMeta, refundedAt: nowIso };

  const [updated] = await db
    .update(transactions)
    .set({
      status: 'REFUNDED',
      metadataJson: JSON.stringify(nextMeta),
      updatedAt: nowIso,
    })
    .where(and(eq(transactions.id, transactionId), eq(transactions.status, 'PAID')))
    .returning();

  if (!updated) return { transaction: null, webhookTriggered: false };

  transactionEvents.emit({
    transactionId: updated.id,
    merchantId: updated.merchantId,
    status: 'REFUNDED',
    totalAmount: updated.totalAmount,
    paidVia: updated.paidVia,
    paidReference: updated.paidReference,
    paidAt: updated.paidAt,
    expiresAt: updated.expiresAt,
    updatedAt: updated.updatedAt,
  });

  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, updated.merchantId));
  let webhookTriggered = false;
  if (merchant?.webhookUrl) {
    await dispatchWebhook(db, updated, merchant, 'payment.refunded');
    webhookTriggered = true;
  }

  return { transaction: updated, webhookTriggered };
}
