# Dokumentasi Teknis — QRIS Dinamis SDK & Webhook Engine

## 1. Instalasi & Menjalankan Lokal

```bash
# Install seluruh dependencies monorepo
pnpm install

# Build seluruh packages
pnpm build

# Jalankan unit & integration tests
pnpm test

# Jalankan API server (http://localhost:3001) & Web Dashboard (http://localhost:5173)
pnpm dev
```

---

## 2. Penggunaan `@qris-dinamis/core` (Package NPM)

### A. Konversi QRIS Statis → Dinamis (Stateless)
```ts
import { convertStaticToDynamic, renderQrSvg, parseQris } from '@qris-dinamis/core';

const staticQris = '000201010211...6304ABCD';

// 1. Konversi ke QRIS Dinamis nominal Rp 50.000
const result = convertStaticToDynamic(staticQris, {
  amount: 50000,
  fee: { type: 'fixed', value: 500 }, // opsional: 'none' | 'prompt' | 'fixed' | 'percentage'
});

console.log(result.dynamicQris); // String QRIS Dinamis valid dengan Tag 01=12, Tag 54=50000, CRC baru
console.log(result.merchant);    // { name, city, nmid, acquirer }

// 2. Render ke SVG atau PNG DataURL
const svg = await renderQrSvg(result.dynamicQris);
```

### B. Verifikasi Webhook di Aplikasi Developer
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

  const event = JSON.parse(rawBody);
  // event.type === 'payment.paid'
  // event.data.transactionId, event.data.totalAmount, event.data.externalId
  return res.status(200).json({ received: true });
});
```

---

## 3. REST API Endpoints (`apps/api`)

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/health` | Healthcheck server & database |
| `GET` | `/docs` | Dokumentasi interaktif OpenAPI 3.1 (Scalar UI) |
| `POST` | `/v1/merchants` | Daftarkan profil QRIS statis & webhook URL |
| `GET` | `/v1/merchants` | Daftar merchant |
| `POST` | `/v1/qris/convert` | Konversi stateless QRIS statis ke dinamis |
| `POST` | `/v1/qris/generate` | Buat transaksi dinamis (dengan opsi kode unik + TTL) |
| `GET` | `/v1/qris/:id` | Cek status transaksi & QR payload |
| `POST` | `/v1/ingest/notification` | Endpoint penerima notifikasi pembayaran (Android/Mutasi) |
| `POST` | `/v1/sandbox/simulate-pay` | Simulasi pembayaran sukses untuk testing |
| `GET` | `/v1/webhooks/logs` | Daftar log pengiriman webhook |
| `POST` | `/v1/webhooks/:id/retry` | Kirim ulang webhook secara manual |
