# Changelog

All notable changes to this project will be documented in this file.

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
