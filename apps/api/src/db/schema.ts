import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const merchants = sqliteTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  staticQris: text('static_qris').notNull(),
  nmid: text('nmid'),
  city: text('city'),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret').notNull(),
  apiKey: text('api_key').notNull().unique(),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    idempotencyKey: text('idempotency_key').unique(),
    mode: text('mode').notNull().default('MPM'), // MPM | CPM
    baseAmount: integer('base_amount').notNull(),
    uniqueCode: integer('unique_code').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    feeType: text('fee_type'),
    feeValue: real('fee_value'),
    dynamicQris: text('dynamic_qris').notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | PAID | EXPIRED | FAILED
    paidVia: text('paid_via'),
    paidReference: text('paid_reference'),
    metadataJson: text('metadata_json'),
    expiresAt: text('expires_at').notNull(),
    paidAt: text('paid_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_tx_merchant_status_amount').on(table.merchantId, table.status, table.totalAmount),
    index('idx_tx_expires').on(table.status, table.expiresAt),
  ],
);

export const webhookLogs = sqliteTable('webhook_logs', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  targetUrl: text('target_url').notNull(),
  payloadJson: text('payload_json').notNull(),
  signature: text('signature').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  httpStatus: integer('http_status'),
  responseBody: text('response_body'),
  status: text('status').notNull().default('PENDING'), // PENDING | DELIVERED | FAILED
  nextRetryAt: text('next_retry_at'),
  lastAttemptAt: text('last_attempt_at'),
  createdAt: text('created_at').notNull(),
});

export const ingestEvents = sqliteTable('ingest_events', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  rawPayload: text('raw_payload').notNull(),
  extractedAmount: integer('extracted_amount'),
  matchedTransactionId: text('matched_transaction_id'),
  status: text('status').notNull(), // MATCHED | UNMATCHED | DUPLICATE
  createdAt: text('created_at').notNull(),
});

export type MerchantRow = typeof merchants.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type WebhookLogRow = typeof webhookLogs.$inferSelect;
export type IngestEventRow = typeof ingestEvents.$inferSelect;
