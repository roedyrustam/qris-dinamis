# Product Requirements Document (PRD) — QRIS Dinamis SDK & Webhook Engine

## 1. Ringkasan Produk
**QRIS Dinamis** adalah monorepo TypeScript/Node.js yang menyediakan:
1. **`@qris-dinamis/core`**: Package NPM ringan untuk parsing, validasi, dan konversi string **QRIS Statis** (EMVCo Merchant-Presented Mode) menjadi **QRIS Dinamis** lengkap dengan nominal (`Tag 54`), biaya/tip (`Tag 55-57`), kalkulasi ulang `CRC-16/CCITT-FALSE` (`Tag 63`), renderer QR (SVG, PNG DataURL, Terminal ASCII), helper verifikasi HMAC webhook, dan typed HTTP Client SDK.
2. **`@qris-dinamis/api`**: Server REST API & Webhook Engine berbasis **Hono** + **Drizzle ORM** (SQLite zero-config / PostgreSQL) dengan arsitektur **Pluggable Payment Verifier**, manajemen transaksi idempoten, kode unik anti-kolisi, expiry TTL, serta pengiriman webhook bertanda tangan **HMAC-SHA256** dengan exponential backoff retry.
3. **`@qris-dinamis/web`**: Dashboard interaktif untuk *Playground* konversi QRIS, manajemen profil merchant, monitor transaksi & simulasi sandbox, serta *Webhook Delivery Inspector*.

---

## 2. Masalah & Tujuan
- **Masalah**: Banyak UMKM dan developer memiliki QRIS statis, namun tidak memiliki cara mudah untuk menyematkan nominal otomatis, melacak status pembayaran secara programatik, dan menerima webhook real-time tanpa integrasi PG yang kompleks.
- **Tujuan**: Memberikan developer 1 package NPM + 1 self-hostable API server yang bisa langsung dipakai dalam hitungan menit, baik secara *stateless* (konversi string) maupun *stateful* (transaksi + unique code + webhook otomatis).

---

## 3. Fitur Utama & Spesifikasi Fungsional

### F1 — Core EMVCo QRIS Engine (`@qris-dinamis/core`)
- **Parser TLV**: Memecah string QRIS menjadi array/map `{ tag, length, value }` termasuk sub-tag `26-45` (Merchant Account Information) dan `62` (Additional Data Field).
- **Validator**: Memverifikasi format EMVCo, keberadaan `Tag 00` (`01`), `Tag 53` (`360` IDR), `Tag 58` (`ID`), dan kecocokan checksum `Tag 63` (CRC-16/CCITT-FALSE).
- **Converter Static → Dynamic**:
  - Mengubah `Tag 01` dari `11` (Static) menjadi `12` (Dynamic).
  - Menyisipkan/memperbarui `Tag 54` (Transaction Amount) dengan validasi nominal positif.
  - Mendukung opsi fee/tip: `Tag 55` (`01` tip prompt, `02` fixed fee + `Tag 56`, `03` percentage fee + `Tag 57`).
  - Menghitung ulang `Tag 63` (CRC-16/CCITT-FALSE, polynomial `0x1021`, init `0xFFFF`).
- **QR Renderer**: Output `SVG` string, `PNG DataURL` (base64), dan `Terminal ASCII`.
- **Webhook Helper**: `signWebhookPayload(secret, timestamp, body)` dan `verifyWebhookSignature(secret, signatureHeader, timestampHeader, rawBody)`.

### F2 — REST API & Pluggable Verifier (`@qris-dinamis/api`)
- **Merchant Management (`/v1/merchants`)**: Simpan static QRIS string, nama merchant (auto-extracted dari `Tag 59`), `webhookUrl`, `webhookSecret`, dan API key.
- **Dynamic QRIS Generation (`/v1/qris/generate`)**:
  - Mendukung `idempotencyKey` agar request duplikat mengembalikan transaksi yang sama.
  - Mendukung `useUniqueCode` (opsional, default `true`): menambahkan kode unik `1..999` yang dijamin tidak bentrok dengan transaksi `PENDING` lain pada merchant yang sama.
  - Menghitung `expiresAt` berdasarkan `ttlSeconds` (default `900` detik / 15 menit).
- **Pluggable Payment Verifier**:
  - `POST /v1/ingest/notification`: Menerima payload notifikasi pembayaran (dari Android Notification Listener, email parser, atau mutasi agent), mengekstrak nominal, mencocokkan dengan transaksi `PENDING` yang cocok secara atomik, dan mengubah status ke `PAID`.
  - `POST /v1/sandbox/simulate-pay`: Endpoint simulasi pembayaran untuk environment dev/staging.
  - Interface `PaymentVerifierAdapter` untuk ekstensi adapter PG resmi (DOKU/Midtrans/Xendit) atau mutasi bank.
- **Webhook Delivery Engine**:
  - Mengirim `POST` ke `webhookUrl` dengan header `X-Qris-Signature` (`t=<unix>,v1=<hmac_sha256>`), `X-Qris-Event` (`payment.paid` | `payment.expired`), dan `X-Qris-Delivery-Id`.
  - Exponential backoff retry (maksimal 5 kali percobaan) dan log pengiriman lengkap.

### F3 — Interactive Playground & Dashboard (`@qris-dinamis/web`)
- **Static-to-Dynamic Playground**: Uji konversi QRIS instan + inspeksi TLV diff.
- **Merchant & API Key Manager**: Tambah merchant dan salin konfigurasi webhook.
- **Transaction & Sandbox Monitor**: Lihat transaksi aktif, timer kedaluwarsa, dan tombol *Simulate Pay* / *Test Notification Ingest*.
- **Webhook Inspector**: Inspeksi log pengiriman webhook, status HTTP, payload, dan tombol *Manual Retry*.
- **Legal & Privacy Routes**: `/privacy`, `/terms`, dan `/delete-account`.

---

## 4. Non-Functional Requirements (NFR)
- **Latensi Konversi Core**: `< 5 ms` per konversi string QRIS di Node.js 22.
- **Idempotensi & Atomisitas**: Transisi status `PENDING -> PAID` wajib atomik (mencegah double-webhook pada concurrent ingest).
- **Keamanan**:
  - Webhook wajib ditandatangani dengan HMAC-SHA256 + timestamp replay protection.
  - API Key merchant di-hash atau diverifikasi dengan `crypto.timingSafeEqual`.
- **Kompatibilitas**: Zero-config local run menggunakan SQLite (`@libsql/client` file DB) dan siap produksi dengan PostgreSQL.
