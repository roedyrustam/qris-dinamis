# Entity Relationship Diagram (ERD) & Database Schema

## 1. Diagram Relasi Entitas

```mermaid
erDiagram
    MERCHANTS ||--o{ TRANSACTIONS : "owns"
    TRANSACTIONS ||--o{ WEBHOOK_LOGS : "triggers"
    MERCHANTS ||--o{ INGEST_EVENTS : "receives"

    MERCHANTS {
        text id PK
        text name
        text static_qris
        text nmid
        text city
        text webhook_url
        text webhook_secret
        text api_key UK
        integer is_active
        text created_at
        text updated_at
    }

    TRANSACTIONS {
        text id PK
        text merchant_id FK
        text external_id
        text idempotency_key UK
        text mode
        integer base_amount
        integer unique_code
        integer total_amount
        text fee_type
        real fee_value
        text dynamic_qris
        text status
        text paid_via
        text paid_reference
        text metadata_json
        text expires_at
        text paid_at
        text created_at
        text updated_at
    }

    WEBHOOK_LOGS {
        text id PK
        text transaction_id FK
        text merchant_id FK
        text event_type
        text target_url
        text payload_json
        text signature
        integer attempt_count
        integer max_attempts
        integer http_status
        text response_body
        text status
        text next_retry_at
        text last_attempt_at
        text created_at
    }

    INGEST_EVENTS {
        text id PK
        text merchant_id FK
        text source
        text raw_payload
        integer extracted_amount
        text matched_transaction_id
        text status
        text created_at
    }
```

---

## 2. SQLite / PostgreSQL DDL Reference

```sql
CREATE TABLE merchants (
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
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  external_id TEXT,
  idempotency_key TEXT UNIQUE,
  mode TEXT NOT NULL DEFAULT 'MPM', -- MPM | CPM
  base_amount INTEGER NOT NULL,
  unique_code INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  fee_type TEXT,
  fee_value REAL,
  dynamic_qris TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PAID | EXPIRED | FAILED
  paid_via TEXT,
  paid_reference TEXT,
  metadata_json TEXT,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tx_merchant_status_amount ON transactions(merchant_id, status, total_amount);
CREATE INDEX idx_tx_expires ON transactions(status, expires_at);

CREATE TABLE webhook_logs (
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
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | DELIVERED | FAILED
  next_retry_at TEXT,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE ingest_events (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  extracted_amount INTEGER,
  matched_transaction_id TEXT,
  status TEXT NOT NULL, -- MATCHED | UNMATCHED | DUPLICATE
  created_at TEXT NOT NULL
);
```
