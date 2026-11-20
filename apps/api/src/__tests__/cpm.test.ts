import { createHmac } from 'node:crypto';
import http from 'node:http';
import { buildSampleCpmQr, computeCrc16, verifyWebhookSignature } from '@qris-dinamis/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDb } from '../db/client.js';

function buildStaticQris(): string {
  const body =
    '00020101021126670015ID.CO.GOPAY.WWW01189360089800012345670215ID10200300405060303UMI5204549953033605802ID5914WARUNG DIGITAL6007JAKARTA6304';
  return `${body}${computeCrc16(body)}`;
}

describe('QRIS Customer-Presented Mode (CPM)', () => {
  let webhookServer: http.Server;
  let webhookUrl = '';
  const receivedWebhooks: Array<{ signature: string; body: string }> = [];

  beforeAll(async () => {
    webhookServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        receivedWebhooks.push({
          signature: String(req.headers['x-qris-signature'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => webhookServer.listen(0, '127.0.0.1', resolve));
    const addr = webhookServer.address() as { port: number };
    webhookUrl = `http://127.0.0.1:${addr.port}/hook`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
  });

  it('validates CPM QR, authorizes payment as acquirer, triggers signed webhook, and handles idempotency/decline', async () => {
    const { db, client } = await createDb('file::memory:');
    try {
      const app = createApp(db);

      const mRes = await app.request('/v1/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQris: buildStaticQris(), webhookUrl }),
      });
      const { merchant } = (await mRes.json()) as { merchant: { id: string; webhookSecret: string } };

      const sampleCpm = buildSampleCpmQr({ wallet: 'DANA', pan: '936008980001234567' });

      // 1. Validate CPM QR
      const valRes = await app.request('/v1/qris/cpm/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrData: sampleCpm }),
      });
      expect(valRes.status).toBe(200);
      const valJson = (await valRes.json()) as { valid: boolean; wallet: string; format: string };
      expect(valJson.valid).toBe(true);
      expect(valJson.wallet).toBe('DANA');
      expect(valJson.format).toBe('emvco-cpm-base64');

      // 2. Pay via CPM
      const payRes = await app.request('/v1/qris/cpm/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: merchant.id,
          amount: 45000,
          qrData: sampleCpm,
          externalId: 'POS-CPM-001',
          idempotencyKey: 'idem-cpm-1',
        }),
      });
      expect(payRes.status).toBe(200);
      const payJson = (await payRes.json()) as {
        approved: boolean;
        wallet: string;
        webhookTriggered: boolean;
        transaction: { id: string; mode: string; status: string; totalAmount: number; paidVia: string };
      };
      expect(payJson.approved).toBe(true);
      expect(payJson.wallet).toBe('DANA');
      expect(payJson.webhookTriggered).toBe(true);
      expect(payJson.transaction.mode).toBe('CPM');
      expect(payJson.transaction.status).toBe('PAID');
      expect(payJson.transaction.totalAmount).toBe(45000);
      expect(payJson.transaction.paidVia).toBe('cpm:dana');

      expect(receivedWebhooks.length).toBe(1);
      expect(
        verifyWebhookSignature({
          secret: merchant.webhookSecret,
          signatureHeader: receivedWebhooks[0]!.signature,
          rawBody: receivedWebhooks[0]!.body,
        }),
      ).toBe(true);

      // 3. Idempotent replay
      const replayRes = await app.request('/v1/qris/cpm/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: merchant.id,
          amount: 45000,
          qrData: sampleCpm,
          idempotencyKey: 'idem-cpm-1',
        }),
      });
      const replayJson = (await replayRes.json()) as {
        idempotentReplay: boolean;
        transaction: { id: string };
      };
      expect(replayJson.idempotentReplay).toBe(true);
      expect(replayJson.transaction.id).toBe(payJson.transaction.id);

      // 4. Deterministic decline (token ending in 0000)
      const declineRes = await app.request('/v1/qris/cpm/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: merchant.id,
          amount: 20000,
          qrData: '93600898000123450000',
        }),
      });
      expect(declineRes.status).toBe(200);
      const declineJson = (await declineRes.json()) as {
        approved: boolean;
        transaction: { status: string; mode: string };
      };
      expect(declineJson.approved).toBe(false);
      expect(declineJson.transaction.mode).toBe('CPM');
      expect(declineJson.transaction.status).toBe('FAILED');
    } finally {
      client.close();
    }
  });
});
