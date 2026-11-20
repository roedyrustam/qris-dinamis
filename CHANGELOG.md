# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] - 2026-11-20

### Fixed & Improved
- **EMVCo Static-to-Dynamic QRIS Spec Compliance (`@qris-dinamis/core`)**:
  - Updated `computeCrc16` to hash UTF-8 bytes and `verifyCrc16` to trim trailing whitespace/newlines.
  - Enforced canonical `Tag 53 → 54 → 55 → 56/57 → 58` ordering, EMVCo `Tag 54/56` max 13 chars, and `Tag 57` percentage range `0.01–99.99`.
  - Added mandatory MAI (`Tags 26–51`) validation, `additionalData` (`Tag 62` sub-tag merge preserving `62-07`), and `Tag 51` National NMID extraction priority.
- **Unclipped QR Code Rendering & TLV Inspector (`@qris-dinamis/web`, `@qris-dinamis/react`)**:
  - Fixed cropped QR preview by rendering full scannable `qrDataUrl` inside quiet-zone containers (`App.tsx`, `CheckoutPage.tsx`, `packages/react`).
  - Added live **EMVCo TLV Inspector** table and clipboard feedback in MPM Playground.

## [2.1.0] - 2026-11-20

### Added & Hardened
- **Webhook SSRF Protection & Bulk DLQ Replay (`@qris-dinamis/api`)**: Added `isBlockedWebhookUrl` blocking private/loopback/cloud-metadata IPs in production (`ALLOW_PRIVATE_WEBHOOKS`), plus `POST /v1/webhooks/retry-failed` for bulk Dead-Letter Queue replay.
- **Cancel & Refund Lifecycle**: Added `POST /v1/qris/:id/cancel` (`payment.cancelled`) and `POST /v1/qris/:id/refund` (`payment.refunded`) with atomic transitions, SSE events, and typed `QrisDinamisClient` methods.
- **Full Multi-Tenant Scoping**: Auto-scoped `GET /v1/qris`, `GET /v1/qris/export`, `GET /v1/webhooks/logs`, `POST /v1/webhooks/retry-failed`, and `POST /v1/ingest/notification` to `authMerchantId` when `REQUIRE_API_KEY=true`.
- **Observability**: Added `X-Request-Id` correlation middleware and Prometheus `GET /metrics` exposition endpoint.
- **Framework-Agnostic Webhook Handler (`@qris-dinamis/core`)**: Added `createWebhookHandler` (Web Standard `Request -> Response`) for Next.js, Hono, Cloudflare Workers, Bun, and Deno.
- **Live Camera QR Scanner (`@qris-dinamis/web`)**: Added camera scanning (`getUserMedia` + `BarcodeDetector`) in `CpmTerminal.tsx`.

## [2.0.0] - 2026-11-20

### Added & Hardened
- **Multi-Tenant API Key Isolation (`@qris-dinamis/api`)**: Bound `authMerchantId` in `apiKeyAuth` middleware and enforced `403 Forbidden` cross-tenant checks on merchant-scoped endpoints (`/v1/merchants/:id/stats`, `/v1/merchants/:id/rotate-keys`, `/v1/qris/generate`, `/v1/qris/cpm/pay`).
- **CLI CPM Parity (`@qris-dinamis/cli`)**: Added `qris-dinamis cpm sample` and `qris-dinamis cpm validate <qrData>`.
- **React Package Test Coverage (`@qris-dinamis/react`)**: Added Vitest suite verifying `@qris-dinamis/react` exports alongside full workspace build/pack verification.
- **Documentation & Release Alignment**: Updated `README.md` and `.env.example` (`CPM_ACQUIRER_URL`, `CPM_ACQUIRER_TOKEN`) and aligned all 6 workspace packages to `2.0.0`.

## [1.9.0] - 2026-11-20

### Added
- **Dual-Mode QRIS Support (MPM + Customer-Presented Mode / CPM)**:
  - **Core SDK (`@qris-dinamis/core`)**: Added `validateCpmQr` and `buildSampleCpmQr` in `packages/core/src/cpm.ts` supporting EMVCo CPM Base64 BER-TLV (`CPV01`) and 16–32 digit wallet CPM tokens, plus `validateCpmQr` & `payWithCpm` in `QrisDinamisClient`.
  - **API & Acquirer Engine (`@qris-dinamis/api`)**: Added `mode` (`MPM` | `CPM`) to `transactions`, pluggable `CpmAcquirerAdapter` (`SandboxCpmAcquirer` & `SnapBiCpmAcquirer` via `CPM_ACQUIRER_URL`), and endpoints `POST /v1/qris/cpm/validate` & `POST /v1/qris/cpm/pay` with idempotency, SSE, and signed webhook delivery.
  - **Web Dashboard (`@qris-dinamis/web`)**: Added **CPM POS** terminal (`CpmTerminal.tsx`) and `MPM`/`CPM` badges in the transaction monitor.

## [1.8.0] - 2026-11-16

### Added
- **Multi-Instance `RedisEventTransport` (`@qris-dinamis/api`)**: Zero-dependency RESP2 Redis Pub/Sub transport in `apps/api/src/services/events.ts`, auto-enabled via `REDIS_URL`.
- **Drop-in React Package (`@qris-dinamis/react`)**: Added `packages/react` with `useQrisStatus` SSE hook and `<QrisCheckout />` component.
- **Digital & Syariah Bank Adapters**: Added `bsi` (`byond`), `jago`, `seabank`, `jenius`, and `cimb` (`octo`) adapters to `bank-ewallet-adapters.ts`.
- **Ingest Inspector (`@qris-dinamis/api`, `@qris-dinamis/web`)**: Added `GET /v1/ingest/events` and the **Ingest Tester** tab in `@qris-dinamis/web`.
- **Full-Stack E2E Flow & Redis Transport Tests**: Added `apps/api/src/__tests__/e2e-flow.test.ts`.

## [1.7.0] - 2026-11-16

### Added
- **Typed SDK Parity (`@qris-dinamis/core`)**: Added `getMerchantStats`, `rotateMerchantKeys`, `listIngestAdapters`, `parseIngestPreview`, `ingestPgWebhook`, and `getTransactionEventsUrl` to `QrisDinamisClient`.
- **Repository & CI Optimization**: Added `.github/dependabot.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, and deduplicated CI/Release workflow triggers with `concurrency` cancellation.

## [1.6.0] - 2026-11-16

### Added
- **Pluggable EventBusTransport (`@qris-dinamis/api`)**: Refactored `apps/api/src/services/events.ts` with `EventBusTransport` and `InMemoryEventTransport` so multi-instance deployments can plug in Redis Pub/Sub or NATS transports.
- **Drizzle Kit Config**: Added `apps/api/drizzle.config.ts` supporting SQLite and PostgreSQL schema pushes.
- **Documentation Sync**: Updated root `README.md` with SSE/Checkout, Analytics/Export/Key Rotation, Official PG adapters, and Android Notification Listener documentation.

## [1.5.0] - 2026-11-16

### Added
- **Android Notification Listener Companion (`examples/android-listener/`)**:
  - Added `QrisNotificationListenerService.kt` (Kotlin `NotificationListenerService`) and `termux-bridge.sh` (Termux + Termux:API polling bridge) for forwarding BCA, BRI, Mandiri, BNI, GoBiz, OVO, DANA, and ShopeePay notifications to `/v1/ingest/notification`.
- **CLI `ingest` Command (`@qris-dinamis/cli`)**:
  - Added `qris-dinamis ingest` supporting `--preview` (`/v1/ingest/parse-preview`) and live `/v1/ingest/notification`.
- **Environment Template**:
  - Updated `.env.example` with `REQUIRE_API_KEY`, `RATE_LIMIT_MAX`, `DOKU_SECRET_KEY`, and `MIDTRANS_SERVER_KEY`.

## [1.4.0] - 2026-11-16

### Added
- **Official Payment Gateway Webhook Adapters (`@qris-dinamis/api`)**:
  - Added `apps/api/src/verifiers/pg-adapters.ts` with HMAC-SHA256 verification for **DOKU Checkout**, **SNAP BI QRIS MPM Notify** parsing, and SHA-512 verification for **Midtrans**.
  - Added `POST /v1/ingest/pg/:provider` (`doku`, `snap-bi`, `midtrans`) matching `PENDING` transactions by `externalId` or `merchantId` + `totalAmount`, documented in OpenAPI 3.1.
- **Release CI/CD Workflow**:
  - Added `.github/workflows/release.yml` for tag-triggered (`v*`) verification and multi-image GHCR Docker publishing (`qris-dinamis-api`, `qris-dinamis-web`).

## [1.3.0] - 2026-11-16

### Added
- **Merchant Analytics & Key Rotation (`@qris-dinamis/api`, `@qris-dinamis/web`)**:
  - `GET /v1/merchants/:id/stats` returning transaction counts (`PENDING`, `PAID`, `EXPIRED`, `FAILED`), `totalPaidAmount`, `totalUniqueCodeCollected`, and `conversionRate`.
  - `POST /v1/merchants/:id/rotate-keys` for rotating `apiKey` and/or `webhookSecret`.
  - `GET /v1/qris/export?format=csv|json` with CSV formula-injection neutralization and attachment headers.
  - Added **Rotate Keys**, **Export CSV/JSON**, and live summary metrics in `@qris-dinamis/web`.

## [1.2.0] - 2026-11-16

### Added
- **Real-Time SSE Payment Status & Hosted Checkout (`/pay/:id`)**:
  - Added `TransactionEventBus` (`apps/api/src/services/events.ts`) wired into `markTransactionPaid` and `expireStaleTransactions`.
  - Added `GET /v1/transactions/:id/events` (`text/event-stream` SSE with 20s heartbeat and auto-close on terminal state).
  - Added `CheckoutPage` (`/pay/:id`) in `@qris-dinamis/web` with live SSE status updates, countdown timer, unique code breakdown, and QR PNG download.

## [1.1.0] - 2026-11-16

### Added

#### Bank & E-Wallet Notification Parser Suite (`@qris-dinamis/api`)
- **8 Dedicated Verifier Adapters**: Added declarative adapters in `apps/api/src/verifiers/bank-ewallet-adapters.ts` for `bca` (`mybca`, `bca-mobile`, `klikbca`), `bri` (`brimo`, `brilink`), `mandiri` (`livin`, `livin-merchant`, `kopra`), `bni` (`wondr`, `bni-mobile`), `gopay` (`gobiz`, `gopay-merchant`), `ovo` (`ovo-merchant`, `grab-merchant`), `dana` (`dana-bisnis`, `dana-merchant`), and `shopeepay` (`shopee-partner`, `spay`).
- **Auto-Detection & Outgoing Guardrail**: Automatically detects bank/e-wallet providers from notification text when `source` is `android-notif` or `auto`, extracts transaction references (`Ref`, `No. Ref`, `Order #`, `Jurnal`, `SN`), and rejects outgoing/debit notifications to prevent false `PAID` transitions.
- **Discovery & Dry-Run Endpoints**: Added `GET /v1/ingest/adapters` and `POST /v1/ingest/parse-preview` (documented in OpenAPI 3.1).

#### CLI Tool (`@qris-dinamis/cli`)
- Added `@qris-dinamis/cli` (`qris-dinamis`) supporting `convert` (`string`, `svg`, `terminal`, `json`), `validate`, `inspect`, and `webhook sign|verify|test`.

#### Repository Optimization
- Added `LICENSE` (MIT), npm/GitHub package metadata (`keywords`, `repository`, `bugs`, `homepage`), CI/license badges in `README.md`, and updated `.gitignore`.

## [1.0.0] - 2026-11-16

### Added

#### Core SDK (`@qris-dinamis/core`)
- **EMVCo TLV Engine**: `parseTlv`, `serializeTlv`, `extractMerchantInfo`, and `QrisParseError` supporting nested sub-tags (`26–45` Merchant Account Information, `62` Additional Data Field).
- **CRC-16/CCITT-FALSE**: `computeCrc16` and `verifyCrc16` (`0x1021` polynomial, `0xFFFF` init).
- **Static-to-Dynamic Converter**: `convertStaticToDynamic` and `validateQris` supporting `Tag 01` (`11` → `12`), `Tag 54` transaction amount, `Tags 55–57` fee/tip modes (`none`, `prompt`, `fixed`, `percentage`), and automatic `Tag 63` recalculation.
- **QR Renderers**: `renderQrSvg`, `renderQrDataUrl`, and `renderQrTerminal`.
- **Webhook Security**: `signWebhookPayload` and `verifyWebhookSignature` with `t=<unix>,v1=<hex>` format, `timingSafeEqual`, and configurable replay-attack tolerance.
- **Typed API Client**: `QrisDinamisClient` covering merchant creation, QR image decode/convert, dynamic QRIS generation, transaction lookup, payment simulation, and notification ingestion.

#### REST API & Webhook Engine (`@qris-dinamis/api`)
- **Hono + Drizzle ORM**: Zero-config SQLite (`@libsql/client`) with PostgreSQL compatibility across `merchants`, `transactions`, `webhook_logs`, and `ingest_events` tables.
- **Merchant Management**: `POST/GET /v1/merchants`, `GET/PATCH/DELETE /v1/merchants/:id`, and `POST /v1/merchants/upload` for QR image-based onboarding.
- **QRIS Endpoints**: Stateless conversion (`POST /v1/qris/convert`), image decoding/conversion (`POST /v1/qris/decode-image`, `POST /v1/qris/convert-image` via `jimp` + `jsqr`), stateful generation (`POST /v1/qris/generate`) with `idempotencyKey`, anti-collision unique code (`1..999`), and configurable `ttlSeconds`.
- **Pluggable Payment Verifier & Sandbox**: `POST /v1/ingest/notification` for atomic `PENDING → PAID` matching from payment notifications and `POST /v1/sandbox/simulate-pay` for local/staging testing.
- **HMAC-SHA256 Webhook Engine**: Automatic delivery on `payment.paid` / `payment.expired` with `X-Qris-Signature`, `X-Qris-Event`, `X-Qris-Delivery-Id`, exponential backoff retries, `GET /v1/webhooks/logs`, and `POST /v1/webhooks/:id/retry`.
- **Security & Operations**: Sliding-window per-IP rate limiter (`RATE_LIMIT_MAX`), optional merchant API key authentication (`REQUIRE_API_KEY=true`), graceful `SIGINT`/`SIGTERM` shutdown, `/health` check, and OpenAPI 3.1 Scalar documentation at `/docs` (`/openapi.json`).

#### Web Dashboard (`@qris-dinamis/web`)
- **Static-to-Dynamic Playground**: Instant QRIS conversion, QR code image upload/decode, and live TLV/merchant inspection.
- **Merchant & API Key Manager**: Register merchants, upload static QRIS images, and copy webhook secrets.
- **Transaction & Sandbox Monitor**: Track active/paid/expired transactions and trigger simulated payments.
- **Webhook Delivery Inspector**: View delivery attempts, HTTP status codes, payloads, and trigger manual retries.
- **Legal & Compliance Views**: Built-in `/privacy`, `/terms`, and `/delete-account` routes.

#### DevOps & Documentation
- Multi-stage Dockerfiles for `@qris-dinamis/api` and `@qris-dinamis/web` (Nginx SPA + API reverse proxy) with `docker-compose.yml` and `.dockerignore`.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) running `pnpm install`, `pnpm build`, `pnpm typecheck`, and `pnpm test`.
- Root `README.md`, `packages/core/README.md`, `CHANGELOG.md`, `PRD.md`, `ERD.md`, and `DOCUMENTATION.md`.
