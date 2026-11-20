# Dokumentasi Teknis — QRIS Dinamis v2.2.0 (MPM & CPM SDK, CLI, API & Webhook Engine)

## 1. Instalasi & Menjalankan Lokal

```bash
# Install seluruh dependencies monorepo
pnpm install

# Build seluruh 5 workspace packages
pnpm build

# Jalankan typecheck & seluruh test suite
pnpm typecheck
pnpm test

# Jalankan API server (http://localhost:3001) & Web Dashboard (http://localhost:5173)
pnpm dev
```

---

## 2. Penggunaan `@qris-dinamis/core` (Package NPM)

### A. Merchant-Presented Mode (MPM): Konversi Statis → Dinamis
```ts
import { convertStaticToDynamic, renderQrSvg, validateQris } from '@qris-dinamis/core';

const staticQris = '000201010211...6304ABCD';

const check = validateQris(staticQris);
if (!check.valid) throw new Error(check.errors.join(', '));

const result = convertStaticToDynamic(staticQris, {
  amount: 50000,
  fee: { type: 'fixed', value: 500 }, // 'none' | 'prompt' | 'fixed' | 'percentage'
});

console.log(result.dynamicQris); // String QRIS Dinamis valid (Tag 01=12, Tag 54=50000, Tag 63 CRC baru)
const svg = await renderQrSvg(result.dynamicQris);
```

### B. Customer-Presented Mode (CPM): Validasi & Charge sebagai Acquirer
```ts
import { buildSampleCpmQr, QrisDinamisClient, validateCpmQr } from '@qris-dinamis/core';

// Validasi QR pelanggan (EMVCo CPM Base64 BER-TLV atau token 16-32 digit)
const scannedQr = buildSampleCpmQr({ wallet: 'DANA' });
const validation = validateCpmQr(scannedQr);
console.log(validation); // { valid: true, format: 'emvco-cpm-base64', wallet: 'DANA', maskedToken: '9360****4567' }

// Proses pembayaran CPM via API
const client = new QrisDinamisClient({ baseUrl: 'http://localhost:3001', apiKey: process.env.QRIS_API_KEY });
const payment = await client.payWithCpm({
  merchantId: 'merch_xxx',
  amount: 45000,
  qrData: scannedQr,
  externalId: 'POS-001',
  idempotencyKey: 'idem-pos-001',
});
console.log(payment.approved, payment.transaction.status); // true, 'PAID'
```

### C. Verifikasi Webhook HMAC-SHA256
```ts
import { verifyWebhookSignature } from '@qris-dinamis/core';

app.post('/webhooks/qris', async (req, res) => {
  const signature = req.headers['x-qris-signature'];
  const rawBody = await req.text();

  const isValid = verifyWebhookSignature({
    secret: process.env.QRIS_WEBHOOK_SECRET!,
    signatureHeader: signature,
    rawBody,
    toleranceSeconds: 300,
  });

  if (!isValid) return res.status(401).send('Invalid signature');
  const event = JSON.parse(rawBody); // 'payment.paid' | 'payment.expired'
  return res.status(200).json({ received: true });
});
```

---

## 3. REST API Endpoints (`@qris-dinamis/api`)

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/health` | Healthcheck server & database |
| `GET` | `/metrics` | Metrik observabilitas format Prometheus (`qris_http_*`, `qris_transactions_total`) |
| `GET` | `/docs` | Dokumentasi interaktif OpenAPI 3.1 (Scalar UI) |
| `POST` | `/v1/merchants` | Daftarkan profil QRIS statis & webhook URL |
| `POST` | `/v1/merchants/upload` | Daftarkan merchant dari unggahan gambar QRIS (PNG/JPG/Base64) |
| `GET` | `/v1/merchants` | Daftar merchant |
| `GET` / `PATCH` / `DELETE` | `/v1/merchants/:id` | Detail, ubah konfigurasi, atau hapus merchant |
| `GET` | `/v1/merchants/:id/stats` | Statistik omzet, jumlah transaksi per status, & conversion rate |
| `POST` | `/v1/merchants/:id/rotate-keys` | Rotasi `apiKey` dan/atau `webhookSecret` |
| `POST` | `/v1/qris/decode-image` | Decode string QRIS dari gambar (PNG/JPG/Base64) |
| `POST` | `/v1/qris/convert-image` | Decode gambar & konversi langsung ke QRIS Dinamis |
| `POST` | `/v1/qris/convert` | Konversi stateless QRIS statis ke dinamis (MPM) |
| `POST` | `/v1/qris/generate` | Buat transaksi MPM dinamis (kode unik + TTL + idempotencyKey) |
| `POST` | `/v1/qris/cpm/validate` | Validasi payload QR pelanggan (CPM) |
| `POST` | `/v1/qris/cpm/pay` | Proses pembayaran CPM sebagai acquirer (Sandbox / SNAP BI) |
| `GET` | `/v1/qris` | Daftar transaksi (filter `merchantId`, `status`) |
| `GET` | `/v1/qris/export` | Ekspor transaksi ke `csv` atau `json` |
| `GET` | `/v1/qris/:id` | Cek status transaksi, `merchantName`, & QR SVG/DataURL |
| `POST` | `/v1/qris/:id/cancel` | Batalkan transaksi `PENDING` (`payment.cancelled`) |
| `POST` | `/v1/qris/:id/refund` | Refund transaksi `PAID` (`payment.refunded`) |
| `GET` | `/v1/transactions/:id/events` | Real-time SSE stream (`PENDING` → `PAID` / `EXPIRED` / `CANCELLED` / `REFUNDED`) |
| `GET` | `/v1/ingest/adapters` | Daftar 13 adapter notifikasi bank & e-wallet Indonesia |
| `GET` | `/v1/ingest/events` | Daftar log event ingest notifikasi terbaru |
| `POST` | `/v1/ingest/parse-preview` | Dry-run uji ekstraksi notifikasi tanpa mutasi DB |
| `POST` | `/v1/ingest/notification` | Ingest notifikasi pembayaran masuk (Android/Termux/Mutasi) |
| `POST` | `/v1/ingest/pg/:provider` | Webhook PG resmi (`doku`, `snap-bi`, `midtrans`) |
| `POST` | `/v1/sandbox/simulate-pay` | Simulasi pembayaran sukses untuk testing |
| `GET` | `/v1/webhooks/logs` | Daftar log pengiriman webhook |
| `POST` | `/v1/webhooks/retry-failed` | Replay massal webhook berstatus `FAILED` (DLQ) |
| `POST` | `/v1/webhooks/:id/retry` | Kirim ulang webhook secara manual |
