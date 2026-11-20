import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type AppDatabase = LibSQLDatabase<typeof schema>;

const INIT_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    static_qris TEXT NOT NULL,
    nmid TEXT,
    city TEXT,
    webhook_url TEXT,
    webhook_secret TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    external_id TEXT,
    idempotency_key TEXT UNIQUE,
    mode TEXT NOT NULL DEFAULT 'MPM',
    base_amount INTEGER NOT NULL,
    unique_code INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL,
    fee_type TEXT,
    fee_value REAL,
    dynamic_qris TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    paid_via TEXT,
    paid_reference TEXT,
    metadata_json TEXT,
    expires_at TEXT NOT NULL,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tx_merchant_status_amount ON transactions(merchant_id, status, total_amount)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_expires ON transactions(status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS webhook_logs (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    target_url TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    signature TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    http_status INTEGER,
    response_body TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    next_retry_at TEXT,
    last_attempt_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ingest_events (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    raw_payload TEXT NOT NULL,
    extracted_amount INTEGER,
    matched_transaction_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

export async function createDb(databaseUrl = process.env.DATABASE_URL ?? 'file:./data/qris.db'): Promise<{
  db: AppDatabase;
  client: Client;
}> {
  if (databaseUrl.startsWith('file:') && databaseUrl !== 'file::memory:') {
    const filePath = databaseUrl.replace(/^file:/, '');
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const client = createClient({ url: databaseUrl });
  for (const sql of INIT_STATEMENTS) {
    await client.execute(sql);
  }
  // Safe additive migration for existing SQLite files created before v1.9.0
  await client.execute(`ALTER TABLE transactions ADD COLUMN mode TEXT NOT NULL DEFAULT 'MPM'`).catch(() => {});

  const db = drizzle(client, { schema });
  return { db, client };
}
