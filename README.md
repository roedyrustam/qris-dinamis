# QRIS Dinamis — SDK, CLI, REST API & Webhook Engine

[![CI](https://github.com/roedyrustam/qris-dinamis/actions/workflows/ci.yml/badge.svg)](https://github.com/roedyrustam/qris-dinamis/actions/workflows/ci.yml)
[![Release](https://github.com/roedyrustam/qris-dinamis/actions/workflows/release.yml/badge.svg)](https://github.com/roedyrustam/qris-dinamis/actions/workflows/release.yml)
[![npm core](https://img.shields.io/npm/v/@qris-dinamis/core?label=%40qris-dinamis%2Fcore)](https://www.npmjs.com/package/@qris-dinamis/core)
[![npm cli](https://img.shields.io/npm/v/@qris-dinamis/cli?label=%40qris-dinamis%2Fcli)](https://www.npmjs.com/package/@qris-dinamis/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220.svg)](https://pnpm.io/)

**QRIS Dinamis** is a TypeScript/Node.js monorepo for converting **Static QRIS** strings (EMVCo Merchant-Presented Mode) into **Dynamic QRIS** payloads with embedded transaction amounts, convenience fees/tips, and recalculated `CRC-16/CCITT-FALSE` checksums. It includes a zero-dependency-heavy core SDK, a self-hostable REST API & HMAC-SHA256 webhook engine, and an interactive web playground & operations dashboard.

---

## Architecture Summary

The repository is structured as a `pnpm` workspace monorepo:

| Package / App | Name | Description |
| :--- | :--- | :--- |
| `packages/core` | `@qris-dinamis/core` | EMVCo TLV parser/serializer, QRIS MPM validator & Static-to-Dynamic converter (Tags `01`, `54`, `55–57`, `63`), EMVCo **CPM** validator (`validateCpmQr`, `buildSampleCpmQr`), QR renderers (`SVG`, `PNG DataURL`, `Terminal`), HMAC-SHA256 webhook signer/verifier, and typed `QrisDinamisClient` SDK. See [packages/core/README.md](./packages/core/README.md). |
| `packages/cli` | `@qris-dinamis/cli` | CLI tool (`qris-dinamis`) for converting, validating, and inspecting QRIS MPM/CPM payloads and testing signed webhooks & notification parsers from the terminal. See [packages/cli/README.md](./packages/cli/README.md). |
| `packages/react` | `@qris-dinamis/react` | Drop-in React `<QrisCheckout />` component and `useQrisStatus` real-time SSE hook. See [packages/react/README.md](./packages/react/README.md). |
| `apps/api` | `@qris-dinamis/api` | Hono REST API + Drizzle ORM supporting **MPM** & **CPM** (acquirer) flows, idempotent transaction generation, anti-collision unique codes (`1..999`), TTL expiration, QR image decoding, 13 Indonesian Bank & E-Wallet notification adapters, official PG webhooks (`DOKU`, `SNAP BI`, `Midtrans`), multi-tenant API key isolation, Redis Pub/Sub SSE (`REDIS_URL`), HMAC-SHA256 webhook retries, and OpenAPI 3.1 docs (`/docs`). |
| `apps/web` | `@qris-dinamis/web` | React 19 + Vite dashboard featuring MPM Playground, **CPM POS** terminal, Merchant & API Key manager, Transaction & Sandbox monitor, Hosted Checkout (`/pay/:id`), Ingest Tester, Webhook Inspector, and legal routes (`/privacy`, `/terms`, `/delete-account`). |

---

## Installation via NPM

### 1. Core SDK (`@qris-dinamis/core`)

```bash
# npm
npm install @qris-dinamis/core

# pnpm
pnpm add @qris-dinamis/core

# yarn
yarn add @qris-dinamis/core
```

Quick TypeScript usage:

```ts
import { convertStaticToDynamic, renderQrSvg, QrisDinamisClient } from '@qris-dinamis/core';

// Stateless Static -> Dynamic QRIS conversion
const { dynamicQris, crc, merchant } = convertStaticToDynamic(STATIC_QRIS, {
  amount: 50000,
  fee: { type: 'fixed', value: 1500 },
});
const svg = await renderQrSvg(dynamicQris);

// Or connect to a self-hosted @qris-dinamis/api server
const client = new QrisDinamisClient({
  baseUrl: 'http://localhost:3001',
  apiKey: process.env.QRIS_API_KEY,
});
```

### 2. CLI Tool (`@qris-dinamis/cli`)

```bash
# Install globally
npm install -g @qris-dinamis/cli

# Or run directly without installing
npx @qris-dinamis/cli convert "<STATIC_QRIS>" --amount 50000 --format terminal
```

---

## Quickstart (Local Development)

**Prerequisites:** Node.js `>= 20.0.0` and pnpm `>= 9.0.0`.

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Copy environment template (optional for local SQLite dev)
cp .env.example .env

# 3. Build all packages
pnpm build

# 4. Run API (http://localhost:3001) & Web Dashboard (http://localhost:5173)
pnpm dev
```

### Testing & Typechecking

```bash
# Run all unit & integration tests across the monorepo
pnpm test

# Run TypeScript typechecking across all packages
pnpm typecheck
```

Once running locally:
- **Web Dashboard & Playground:** `http://localhost:5173`
- **REST API:** `http://localhost:3001`
- **Interactive OpenAPI Docs (Scalar UI):** `http://localhost:3001/docs`
- **Healthcheck:** `http://localhost:3001/health`

---

## CLI Tool (`@qris-dinamis/cli`)

Run the CLI directly from the workspace after building (`pnpm build`):

```bash
# Convert static QRIS to dynamic QRIS with amount & fixed fee
pnpm --filter @qris-dinamis/cli exec qris-dinamis convert "<STATIC_QRIS>" --amount 50000 --fee fixed:1500

# Render dynamic QRIS as SVG file or Terminal ASCII
pnpm --filter @qris-dinamis/cli exec qris-dinamis convert "<STATIC_QRIS>" -a 50000 -f svg -o qris.svg
pnpm --filter @qris-dinamis/cli exec qris-dinamis convert "<STATIC_QRIS>" -a 50000 -f terminal

# Validate & inspect all EMVCo TLV tags
pnpm --filter @qris-dinamis/cli exec qris-dinamis inspect "<QRIS>"

# Sign, verify, or send a signed test webhook
pnpm --filter @qris-dinamis/cli exec qris-dinamis webhook test --url http://localhost:3001/webhook --secret whsec_123 --amount 50123
```

---

## Bank & E-Wallet Notification Adapters

`POST /v1/ingest/notification` and `POST /v1/ingest/parse-preview` support dedicated parsers for Indonesian banks & e-wallets (plus automatic detection from notification text when `source` is `android-notif` or `auto`):

- **Banks:** `bca` (`mybca`, `bca-mobile`, `klikbca`), `bri` (`brimo`, `brilink`), `mandiri` (`livin`, `livin-merchant`, `kopra`), `bni` (`wondr`, `bni-mobile`)
- **E-Wallets:** `gopay` (`gobiz`, `gopay-merchant`), `ovo` (`ovo-merchant`, `grab-merchant`), `dana` (`dana-bisnis`, `dana-merchant`), `shopeepay` (`shopee-partner`, `spay`)
- **Discovery & Dry-Run:** Use `GET /v1/ingest/adapters` to list registered adapters and `POST /v1/ingest/parse-preview` to test notification extraction without mutating transactions.
- **Android Companion:** See [examples/android-listener/README.md](./examples/android-listener/README.md) for Kotlin `NotificationListenerService` and Termux bridge examples.

---

## Real-Time SSE, Hosted Checkout & Official PG Adapters

- **Live Payment Status (SSE):** Subscribe to `GET /v1/transactions/:id/events` (`text/event-stream`) for instant `PENDING` → `PAID` / `EXPIRED` updates without polling. Backed by a pluggable `EventBusTransport` in `apps/api/src/services/events.ts`.
- **Hosted Checkout (`/pay/:id`):** Shareable payment page in `@qris-dinamis/web` with live countdown timer, unique code breakdown, QR PNG download, and real-time SSE confirmation.
- **Analytics, Export & Key Rotation:** `GET /v1/merchants/:id/stats`, `GET /v1/qris/export?format=csv|json`, and `POST /v1/merchants/:id/rotate-keys`.
- **Official PG Webhooks:** `POST /v1/ingest/pg/:provider` supports **DOKU Checkout** (HMAC-SHA256), **SNAP BI QRIS MPM Notify**, and **Midtrans** (SHA-512).

---

## Docker Compose

You can run the full stack (`api` + `web` behind Nginx reverse proxy) using Docker Compose:

```bash
# Build and start all services in the background
docker compose up -d --build

# View logs
docker compose logs -f

# Stop services
docker compose down
```

- **Web Dashboard:** `http://localhost:5173` (Nginx proxies `/v1`, `/health`, `/docs`, and `/openapi.json` to `api:3001`)
- **API Server:** `http://localhost:3001`
- **Persistent SQLite Volume:** `qris_data:/app/apps/api/data`

---

## Environment Variables Reference

Configure via `.env` or container environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3001` | Port the `@qris-dinamis/api` HTTP server listens on. |
| `DATABASE_URL` | `file:./data/qris.db` | LibSQL/SQLite file URL (zero-config local) or PostgreSQL connection string (`postgres://user:pass@host:5432/qris`). |
| `REQUIRE_API_KEY` | `false` | Set to `'true'` to enforce `X-Api-Key` or `Authorization: Bearer <key>` authentication on protected `/v1/*` endpoints. Leave unset or `'false'` for frictionless local playground usage. |
| `RATE_LIMIT_MAX` | `120` | Maximum requests per minute per IP address for the sliding-window rate limiter (returns HTTP `429` with `Retry-After` when exceeded). |
| `WEBHOOK_MAX_ATTEMPTS` | `5` | Maximum webhook delivery attempts (with exponential backoff) before marking a delivery as permanently failed. |
| `WEBHOOK_TIMEOUT_MS` | `8000` | HTTP request timeout in milliseconds when delivering webhooks to merchant endpoints. |
| `DEFAULT_TX_TTL_SECONDS` | `900` | Default transaction expiration window in seconds (15 minutes). |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin for browser requests to the API. |

---

## Documentation

- [Product Requirements Document (PRD.md)](./PRD.md) — Functional specs, core engine rules, and non-functional requirements.
- [Entity Relationship Diagram (ERD.md)](./ERD.md) — Database schema for `merchants`, `transactions`, `webhook_logs`, and `ingest_events`.
- [Technical Documentation (DOCUMENTATION.md)](./DOCUMENTATION.md) — Endpoint reference and integration examples.
- [Core SDK README (packages/core/README.md)](./packages/core/README.md) — NPM installation and TypeScript usage guide.
- [CLI README (packages/cli/README.md)](./packages/cli/README.md) — Terminal conversion, inspection, and webhook testing guide.
- [Changelog (CHANGELOG.md)](./CHANGELOG.md) — Release notes.

---

## Contributing & Community

Contributions are welcome! Please read:
- [Contributing Guide (CONTRIBUTING.md)](./CONTRIBUTING.md) — Local setup, PR workflow, and how to add new bank/e-wallet adapters.
- [Code of Conduct (CODE_OF_CONDUCT.md)](./CODE_OF_CONDUCT.md) — Community standards.
- [Security Policy (SECURITY.md)](./SECURITY.md) — How to report security vulnerabilities responsibly.
