# @qris-dinamis/core

EMVCo QRIS Static-to-Dynamic converter, QR code renderer (SVG, PNG DataURL, Terminal), HMAC-SHA256 webhook signature verifier, and typed REST API client SDK for Node.js & TypeScript.

## Installation

```bash
npm install @qris-dinamis/core
```

Or with `pnpm` / `yarn`:

```bash
pnpm add @qris-dinamis/core
# or
yarn add @qris-dinamis/core
```

---

## TypeScript Usage Examples

### 1. Convert Static QRIS to Dynamic (`convertStaticToDynamic`)

Converts a static QRIS payload (`Tag 01 = "11"`) into a dynamic QRIS payload (`Tag 01 = "12"`) with the transaction amount (`Tag 54`), optional convenience fee/tip (`Tags 55–57`), and a recalculated `CRC-16/CCITT-FALSE` checksum (`Tag 63`).

```ts
import { convertStaticToDynamic } from '@qris-dinamis/core';

const staticQris = '000201010211...53033605802ID5912WARUNG KOPI6007JAKARTA6304XXXX';

const result = convertStaticToDynamic(staticQris, {
  amount: 50000,
  fee: { type: 'fixed', value: 500 }, // 'none' | 'prompt' | 'fixed' | 'percentage'
});

console.log(result.dynamicQris); // Valid Dynamic QRIS string
console.log(result.crc);         // 4-char hex CRC-16 checksum
console.log(result.merchant);    // { name, city, nmid, acquirer, ... }
```

### 2. Render QR Code as SVG (`renderQrSvg`)

Generates an SVG markup string from any QRIS payload, with optional sizing and color customization.

```ts
import { renderQrSvg } from '@qris-dinamis/core';

const svg = await renderQrSvg(result.dynamicQris, {
  width: 320,
  margin: 2,
  color: {
    dark: '#0f172a',
    light: '#ffffff',
  },
});

// `svg` is an <svg>...</svg> string ready to embed in HTML or save to disk
```

> Also available: `renderQrDataUrl(qris, options)` for PNG base64 Data URLs and `renderQrTerminal(qris)` for UTF-8 terminal output.

### 3. Verify Webhook Signatures (`verifyWebhookSignature`)

Verifies incoming `X-Qris-Signature` headers (`t=<unix>,v1=<hmac_sha256>`) using constant-time comparison (`timingSafeEqual`) and replay-attack timestamp tolerance.

```ts
import { verifyWebhookSignature } from '@qris-dinamis/core';

const isValid = verifyWebhookSignature({
  secret: process.env.QRIS_WEBHOOK_SECRET!,
  signatureHeader: req.headers['x-qris-signature'] as string | undefined,
  rawBody, // Exact raw UTF-8 request body string
  toleranceSeconds: 300, // Reject timestamps older/newer than 5 minutes (set 0 to disable)
});

if (!isValid) {
  throw new Error('Invalid webhook signature');
}

const event = JSON.parse(rawBody);
// Handle event.type === 'payment.paid' | 'payment.expired'
```

### 4. Typed API Client (`QrisDinamisClient`)

Interact with a self-hosted `@qris-dinamis/api` server using the typed HTTP client.

```ts
import { QrisDinamisClient } from '@qris-dinamis/core';

const client = new QrisDinamisClient({
  baseUrl: 'http://localhost:3001',
  apiKey: process.env.QRIS_API_KEY, // Optional when REQUIRE_API_KEY=false
});

// 1. Register a merchant
const { merchant } = await client.createMerchant({
  staticQris: '000201010211...6304XXXX',
  webhookUrl: 'https://your-app.com/webhooks/qris',
});

// 2. Generate a dynamic QRIS transaction with anti-collision unique code
const { transaction } = await client.generateQris({
  merchantId: String(merchant.id),
  amount: 50000,
  useUniqueCode: true,
  ttlSeconds: 900,
  externalId: 'ORDER-1001',
  idempotencyKey: 'idem-order-1001',
});

console.log(transaction.totalAmount); // e.g. 50001..50999
console.log(transaction.qrDataUrl);   // Ready-to-display PNG DataURL

// 3. Check transaction status or simulate payment in sandbox
const status = await client.getTransaction(transaction.id);
const paid = await client.simulatePayment(transaction.id);
console.log(paid.transaction.status); // 'PAID'
```
