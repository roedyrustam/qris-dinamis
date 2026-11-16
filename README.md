# QRIS Dinamis — SDK, CLI, REST API & Webhook Engine

[![CI](https://github.com/roedyrustam/qris-dinamis/actions/workflows/ci.yml/badge.svg)](https://github.com/roedyrustam/qris-dinamis/actions/workflows/ci.yml)
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
| `packages/core` | `@qris-dinamis/core` | EMVCo TLV parser/serializer, QRIS validator, Static-to-Dynamic converter (Tags `01`, `54`, `55–57`, `63`), QR renderers (`SVG`, `PNG DataURL`, `Terminal`), HMAC-SHA256 webhook signer/verifier, and typed `QrisDinamisClient` SDK. See [packages/core/README.md](./packages/core/README.md). |
| `packages/cli` | `@qris-dinamis/cli` | CLI tool (`qris-dinamis`) for converting, validating, and inspecting QRIS strings (`string`, `svg`, `terminal`, `json`) and signing/verifying/testing HMAC-SHA256 webhooks from the terminal. See [packages/cli/README.md](./packages/cli/README.md). |
| `apps/api` | `@qris-dinamis/api` | Hono REST API + Drizzle ORM (`@libsql/client` SQLite zero-config or PostgreSQL) with idempotent transaction generation, anti-collision unique codes (`1..999`), TTL expiration, QR image decoding (`jimp` + `jsqr`), 8 Indonesian Bank & E-Wallet notification verifier adapters (`BCA`, `BRI`, `Mandiri`, `BNI`, `GoPay`, `OVO`, `DANA`, `ShopeePay`), sandbox simulator, HMAC-SHA256 webhook delivery with exponential backoff, rate limiting, optional API key auth, and OpenAPI 3.1 Scalar docs (`/docs`). |
| `apps/web` | `@qris-dinamis/web` | React 19 + Vite dashboard featuring an interactive Static-to-Dynamic Playground (with QR image upload & TLV inspection), Merchant & API Key manager, Transaction & Sandbox monitor, Webhook Delivery Inspector with manual retry, and legal routes (`/privacy`, `/terms`, `/delete-account`). |

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
