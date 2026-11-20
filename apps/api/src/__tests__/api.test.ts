import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { computeCrc16, renderQrDataUrl, verifyCrc16, verifyWebhookSignature } from '@qris-dinamis/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDb } from '../db/client.js';

function buildStaticQris(): string {
  const body =
    '000201' +
    '010211' +
    '26670015ID.CO.GOPAY.WWW01189360089800012345670215ID10200300405060303UMI' +
    '52045499' +
    '5303360' +
    '5802ID' +
    '5914WARUNG DIGITAL' +
    '6007BANDUNG' +
    '6304';
  return `${body}${computeCrc16(body)}`;
}

describe('@qris-dinamis/api integration', () => {
  let webhookUrl = '';
  const receivedWebhooks: Array<{ headers: IncomingMessage['headers']; rawBody: string }> = [];
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        receivedWebhooks.push({
          headers: req.headers,
          rawBody: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          webhookUrl = `http://127.0.0.1:${addr.port}/webhook`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('registers merchant, generates unique-code dynamic QRIS, matches notification ingest, and delivers signed webhook', async () => {
    const { db, client } = await createDb('file::memory:');
    const app = createApp(db);

    const staticQris = buildStaticQris();
    const webhookSecret = 'whsec_integration_test_999';

    // 1. Register merchant
    const mRes = await app.request('/v1/merchants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        staticQris,
        webhookUrl,
        webhookSecret,
      }),
    });
    expect(mRes.status).toBe(201);
    const { merchant } = (await mRes.json()) as { merchant: { id: string; name: string } };
    expect(merchant.name).toBe('WARUNG DIGITAL');

    // 2. Generate dynamic QRIS with idempotency key & unique code
    const genPayload = {
      merchantId: merchant.id,
      amount: 50000,
      useUniqueCode: true,
      externalId: 'INV-2026-001',
      idempotencyKey: 'idem-001',
    };
    const gRes1 = await app.request('/v1/qris/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(genPayload),
    });
    expect(gRes1.status).toBe(201);
    const gJson1 = (await gRes1.json()) as {
      transaction: { id: string; totalAmount: number; uniqueCode: number; dynamicQris: string };
    };
    expect(gJson1.transaction.uniqueCode).toBeGreaterThanOrEqual(1);
    expect(gJson1.transaction.totalAmount).toBe(50000 + gJson1.transaction.uniqueCode);
    expect(verifyCrc16(gJson1.transaction.dynamicQris)).toBe(true);

    // Idempotent replay check
    const gRes2 = await app.request('/v1/qris/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(genPayload),
    });
    expect(gRes2.status).toBe(200);
    const gJson2 = (await gRes2.json()) as {
      idempotentReplay: boolean;
      transaction: { id: string };
    };
    expect(gJson2.idempotentReplay).toBe(true);
    expect(gJson2.transaction.id).toBe(gJson1.transaction.id);

    // 3. Ingest Indonesian payment notification
    const formattedTotal = gJson1.transaction.totalAmount.toLocaleString('id-ID');
    const ingRes = await app.request('/v1/ingest/notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId: merchant.id,
        source: 'android-notif-gopay',
        text: `Pembayaran QRIS masuk sebesar Rp ${formattedTotal} dari Pelanggan`,
        reference: 'REF-GOPAY-881',
      }),
    });
    expect(ingRes.status).toBe(200);
    const ingJson = (await ingRes.json()) as {
      matched: boolean;
      webhookTriggered: boolean;
      transaction: { status: string; paidVia: string };
    };
    expect(ingJson.matched).toBe(true);
    expect(ingJson.webhookTriggered).toBe(true);
    expect(ingJson.transaction.status).toBe('PAID');

    // 4. Verify HMAC-SHA256 webhook was received and passes verification
    expect(receivedWebhooks.length).toBe(1);
    const wh = receivedWebhooks[0];
    const sigHeader = wh.headers['x-qris-signature'] as string;
    expect(
      verifyWebhookSignature({
        secret: webhookSecret,
        signatureHeader: sigHeader,
        rawBody: wh.rawBody,
      }),
    ).toBe(true);

    const parsedWh = JSON.parse(wh.rawBody) as { type: string; data: { externalId: string } };
    expect(parsedWh.type).toBe('payment.paid');
    expect(parsedWh.data.externalId).toBe('INV-2026-001');

    // 5. Verify webhook logs endpoint
    const logsRes = await app.request(`/v1/webhooks/logs?merchantId=${merchant.id}`);
    expect(logsRes.status).toBe(200);
    const { logs } = (await logsRes.json()) as { logs: Array<{ status: string; httpStatus: number }> };
    expect(logs[0]?.status).toBe('DELIVERED');
    expect(logs[0]?.httpStatus).toBe(200);

    client.close();
  });

  it('supports sandbox simulate-pay endpoint', async () => {
    const { db, client } = await createDb('file::memory:');
    const app = createApp(db);

    const mRes = await app.request('/v1/merchants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staticQris: buildStaticQris(), webhookUrl }),
    });
    const { merchant } = (await mRes.json()) as { merchant: { id: string } };

    const gRes = await app.request('/v1/qris/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantId: merchant.id, amount: 25000, useUniqueCode: false }),
    });
    const { transaction } = (await gRes.json()) as { transaction: { id: string } };

    const simRes = await app.request('/v1/sandbox/simulate-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: transaction.id }),
    });
    expect(simRes.status).toBe(200);
    const simJson = (await simRes.json()) as { transaction: { status: string } };
    expect(simJson.transaction.status).toBe('PAID');

    client.close();
  });

  it('decodes, converts, and registers merchant from uploaded QRIS PNG image', async () => {
    const { db, client } = await createDb('file::memory:');
    const app = createApp(db);

    const staticQris = buildStaticQris();
    const dataUrl = await renderQrDataUrl(staticQris, { width: 320, margin: 2 });
    const pngBuffer = Buffer.from(dataUrl.split(',')[1], 'base64');

    // 1. Decode uploaded PNG via multipart/form-data
    const decodeForm = new FormData();
    decodeForm.append('file', new Blob([new Uint8Array(pngBuffer)], { type: 'image/png' }), 'qris.png');

    const decRes = await app.request('/v1/qris/decode-image', {
      method: 'POST',
      body: decodeForm,
    });
    expect(decRes.status).toBe(200);
    const decJson = (await decRes.json()) as { valid: boolean; staticQris: string; merchant: { name: string } };
    expect(decJson.valid).toBe(true);
    expect(decJson.staticQris).toBe(staticQris);
    expect(decJson.merchant.name).toBe('WARUNG DIGITAL');

    // 2. Convert uploaded PNG directly to Dynamic QRIS
    const convForm = new FormData();
    convForm.append('file', new Blob([new Uint8Array(pngBuffer)], { type: 'image/png' }), 'qris.png');
    convForm.append('amount', '75000');

    const convRes = await app.request('/v1/qris/convert-image', {
      method: 'POST',
      body: convForm,
    });
    expect(convRes.status).toBe(200);
    const convJson = (await convRes.json()) as { dynamicQris: string; qrSvg: string };
    expect(verifyCrc16(convJson.dynamicQris)).toBe(true);
    expect(convJson.qrSvg).toContain('<svg');

    // 3. Register merchant directly via uploaded PNG
    const mForm = new FormData();
    mForm.append('file', new Blob([new Uint8Array(pngBuffer)], { type: 'image/png' }), 'qris.png');
    mForm.append('webhookUrl', webhookUrl);

    const mRes = await app.request('/v1/merchants/upload', {
      method: 'POST',
      body: mForm,
    });
    expect(mRes.status).toBe(201);
    const mJson = (await mRes.json()) as { merchant: { name: string }; decodedStaticQris: string };
    expect(mJson.merchant.name).toBe('WARUNG DIGITAL');
    expect(mJson.decodedStaticQris).toBe(staticQris);

    client.close();
  });

  it('enforces API key authentication when REQUIRE_API_KEY=true', async () => {
    const prevRequireApiKey = process.env.REQUIRE_API_KEY;
    process.env.REQUIRE_API_KEY = 'true';
    const { db, client } = await createDb('file::memory:');

    try {
      const app = createApp(db);

      // Register merchant (public onboarding endpoint) to obtain apiKey
      const mRes = await app.request('/v1/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQris: buildStaticQris(), webhookUrl }),
      });
      expect(mRes.status).toBe(201);
      const { merchant } = (await mRes.json()) as { merchant: { id: string; apiKey: string } };
      expect(merchant.apiKey).toBeTruthy();

      // Protected endpoints reject missing API key with 401
      const noKeyGen = await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: merchant.id, amount: 10000, useUniqueCode: false }),
      });
      expect(noKeyGen.status).toBe(401);

      const noKeyLogs = await app.request('/v1/webhooks/logs');
      expect(noKeyLogs.status).toBe(401);

      // Protected endpoint rejects invalid API key with 401
      const badKeyGen = await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': 'qris_live_invalid_key',
        },
        body: JSON.stringify({ merchantId: merchant.id, amount: 10000, useUniqueCode: false }),
      });
      expect(badKeyGen.status).toBe(401);

      // Valid X-Api-Key succeeds with 201
      const validGen = await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': merchant.apiKey,
        },
        body: JSON.stringify({ merchantId: merchant.id, amount: 10000, useUniqueCode: false }),
      });
      expect(validGen.status).toBe(201);
      const { transaction } = (await validGen.json()) as { transaction: { id: string } };

      // Valid Authorization: Bearer <key> succeeds with 200
      const validGet = await app.request(`/v1/qris/${transaction.id}`, {
        headers: { Authorization: `Bearer ${merchant.apiKey}` },
      });
      expect(validGet.status).toBe(200);

      const validSim = await app.request('/v1/sandbox/simulate-pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${merchant.apiKey}`,
        },
        body: JSON.stringify({ transactionId: transaction.id }),
      });
      expect(validSim.status).toBe(200);
    } finally {
      if (prevRequireApiKey === undefined) {
        delete process.env.REQUIRE_API_KEY;
      } else {
        process.env.REQUIRE_API_KEY = prevRequireApiKey;
      }
      client.close();
    }
  });

  it('enforces sliding-window rate limit and returns 429 with Retry-After', async () => {
    const prevRateLimitMax = process.env.RATE_LIMIT_MAX;
    process.env.RATE_LIMIT_MAX = '3';
    const { db, client } = await createDb('file::memory:');

    try {
      const app = createApp(db);

      for (let i = 0; i < 3; i++) {
        const res = await app.request('/health', {
          headers: { 'X-Forwarded-For': '203.0.113.10' },
        });
        expect(res.status).toBe(200);
      }

      const limitedRes = await app.request('/health', {
        headers: { 'X-Forwarded-For': '203.0.113.10' },
      });
      expect(limitedRes.status).toBe(429);
      const retryAfter = Number(limitedRes.headers.get('Retry-After'));
      expect(Number.isFinite(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
    } finally {
      if (prevRateLimitMax === undefined) {
        delete process.env.RATE_LIMIT_MAX;
      } else {
        process.env.RATE_LIMIT_MAX = prevRateLimitMax;
      }
      client.close();
    }
  });

  it('streams real-time PENDING -> PAID status via SSE /v1/transactions/:id/events', async () => {
    const { db, client } = await createDb('file::memory:');
    try {
      const app = createApp(db);

      const mRes = await app.request('/v1/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQris: buildStaticQris() }),
      });
      const { merchant } = (await mRes.json()) as { merchant: { id: string } };

      const gRes = await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: merchant.id, amount: 30000, useUniqueCode: true }),
      });
      const { transaction } = (await gRes.json()) as { transaction: { id: string } };

      const sseRes = await app.request(`/v1/transactions/${transaction.id}/events`);
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get('content-type')).toContain('text/event-stream');

      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();

      const firstChunk = await reader.read();
      const firstText = decoder.decode(firstChunk.value);
      expect(firstText).toContain('event: status');
      expect(firstText).toContain('"status":"PENDING"');

      // Trigger payment
      const payRes = await app.request('/v1/sandbox/simulate-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: transaction.id }),
      });
      expect(payRes.status).toBe(200);

      const secondChunk = await reader.read();
      const secondText = decoder.decode(secondChunk.value);
      expect(secondText).toContain('event: status');
      expect(secondText).toContain('"status":"PAID"');
    } finally {
      client.close();
    }
  });

  it('computes merchant stats, rotates keys, and exports transactions as CSV', async () => {
    const { db, client } = await createDb('file::memory:');
    try {
      const app = createApp(db);

      const mRes = await app.request('/v1/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQris: buildStaticQris() }),
      });
      const { merchant } = (await mRes.json()) as {
        merchant: { id: string; apiKey: string; webhookSecret: string };
      };

      // Generate 2 transactions and pay 1
      const g1 = await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: merchant.id, amount: 40000, useUniqueCode: true }),
      });
      const tx1 = ((await g1.json()) as { transaction: { id: string; totalAmount: number } }).transaction;

      await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: merchant.id, amount: 25000, useUniqueCode: false }),
      });

      await app.request('/v1/sandbox/simulate-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: tx1.id }),
      });

      // 1. Stats
      const statsRes = await app.request(`/v1/merchants/${merchant.id}/stats`);
      expect(statsRes.status).toBe(200);
      const stats = (await statsRes.json()) as {
        totalTransactions: number;
        counts: { PAID: number; PENDING: number };
        totalPaidAmount: number;
        conversionRate: number;
      };
      expect(stats.totalTransactions).toBe(2);
      expect(stats.counts.PAID).toBe(1);
      expect(stats.counts.PENDING).toBe(1);
      expect(stats.totalPaidAmount).toBe(tx1.totalAmount);
      expect(stats.conversionRate).toBe(50);

      // 2. CSV Export
      const csvRes = await app.request(`/v1/qris/export?merchantId=${merchant.id}&format=csv`);
      expect(csvRes.status).toBe(200);
      expect(csvRes.headers.get('content-type')).toContain('text/csv');
      const csvText = await csvRes.text();
      expect(csvText).toContain('id,merchantId,externalId,baseAmount');
      expect(csvText).toContain(tx1.id);

      // 3. Rotate keys
      const rotRes = await app.request(`/v1/merchants/${merchant.id}/rotate-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotateApiKey: true, rotateWebhookSecret: true }),
      });
      expect(rotRes.status).toBe(200);
      const rotJson = (await rotRes.json()) as {
        merchant: { apiKey: string; webhookSecret: string };
      };
      expect(rotJson.merchant.apiKey).not.toBe(merchant.apiKey);
      expect(rotJson.merchant.webhookSecret).not.toBe(merchant.webhookSecret);
    } finally {
      client.close();
    }
  });

  it('enforces cross-tenant 403 Forbidden isolation when REQUIRE_API_KEY=true', async () => {
    const prevRequireApiKey = process.env.REQUIRE_API_KEY;
    process.env.REQUIRE_API_KEY = 'true';
    const { db, client } = await createDb('file::memory:');
    try {
      const app = createApp(db);

      const m1Res = await app.request('/v1/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQris: buildStaticQris(), name: 'Merchant A' }),
      });
      const m1 = ((await m1Res.json()) as { merchant: { id: string; apiKey: string } }).merchant;

      const m2Res = await app.request('/v1/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQris: buildStaticQris(), name: 'Merchant B' }),
      });
      const m2 = ((await m2Res.json()) as { merchant: { id: string; apiKey: string } }).merchant;

      // Merchant A cannot read Merchant B stats
      const crossStats = await app.request(`/v1/merchants/${m2.id}/stats`, {
        headers: { 'X-Api-Key': m1.apiKey },
      });
      expect(crossStats.status).toBe(403);

      // Merchant A can read its own stats
      const ownStats = await app.request(`/v1/merchants/${m1.id}/stats`, {
        headers: { 'X-Api-Key': m1.apiKey },
      });
      expect(ownStats.status).toBe(200);
    } finally {
      if (prevRequireApiKey === undefined) delete process.env.REQUIRE_API_KEY;
      else process.env.REQUIRE_API_KEY = prevRequireApiKey;
      client.close();
    }
  });
});
