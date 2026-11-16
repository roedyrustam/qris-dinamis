import { createHash, createHmac } from 'node:crypto';
import { computeCrc16 } from '@qris-dinamis/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDb } from '../db/client.js';

function buildStaticQris(): string {
  const body =
    '00020101021126670015ID.CO.GOPAY.WWW01189360089800012345670215ID10200300405060303UMI5204549953033605802ID5914WARUNG DIGITAL6007JAKARTA6304';
  return `${body}${computeCrc16(body)}`;
}

describe('Official Payment Gateway Webhook Adapters (DOKU, SNAP BI, Midtrans)', () => {
  it('verifies DOKU signature and marks matching externalId transaction as PAID', async () => {
    const prevSecret = process.env.DOKU_SECRET_KEY;
    process.env.DOKU_SECRET_KEY = 'SK_TEST_DOKU_123';
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
        body: JSON.stringify({
          merchantId: merchant.id,
          amount: 55000,
          useUniqueCode: false,
          externalId: 'INV-DOKU-001',
        }),
      });
      expect(gRes.status).toBe(201);

      const rawBody = JSON.stringify({
        order: { invoice_number: 'INV-DOKU-001', amount: 55000 },
        transaction: { status: 'SUCCESS', original_request_id: 'REQ-DOKU-99' },
      });

      // Invalid signature rejected with 401
      const badRes = await app.request('/v1/ingest/pg/doku', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': 'BRN-001',
          'Request-Id': 'req-1',
          'Request-Timestamp': '2026-11-16T12:00:00Z',
          Signature: 'HMACSHA256=invalid',
        },
        body: rawBody,
      });
      expect(badRes.status).toBe(401);

      // Valid DOKU signature
      const digest = createHash('sha256').update(rawBody).digest('base64');
      const component = [
        'Client-Id:BRN-001',
        'Request-Id:req-1',
        'Request-Timestamp:2026-11-16T12:00:00Z',
        'Request-Target:/v1/ingest/pg/doku',
        `Digest:${digest}`,
      ].join('\n');
      const sig = `HMACSHA256=${createHmac('sha256', 'SK_TEST_DOKU_123').update(component).digest('base64')}`;

      const okRes = await app.request('/v1/ingest/pg/doku', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': 'BRN-001',
          'Request-Id': 'req-1',
          'Request-Timestamp': '2026-11-16T12:00:00Z',
          Signature: sig,
        },
        body: rawBody,
      });
      expect(okRes.status).toBe(200);
      const okJson = (await okRes.json()) as {
        matched: boolean;
        transaction: { status: string; paidVia: string; paidReference: string };
      };
      expect(okJson.matched).toBe(true);
      expect(okJson.transaction.status).toBe('PAID');
      expect(okJson.transaction.paidVia).toBe('doku');
      expect(okJson.transaction.paidReference).toBe('REQ-DOKU-99');
    } finally {
      if (prevSecret === undefined) delete process.env.DOKU_SECRET_KEY;
      else process.env.DOKU_SECRET_KEY = prevSecret;
      client.close();
    }
  });

  it('reconciles SNAP BI QRIS MPM notify and Midtrans SHA-512 notifications', async () => {
    const prevMidtrans = process.env.MIDTRANS_SERVER_KEY;
    process.env.MIDTRANS_SERVER_KEY = 'SB-Mid-server-TESTKEY';
    const { db, client } = await createDb('file::memory:');

    try {
      const app = createApp(db);

      const mRes = await app.request('/v1/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQris: buildStaticQris() }),
      });
      const { merchant } = (await mRes.json()) as { merchant: { id: string } };

      await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: merchant.id,
          amount: 42000,
          useUniqueCode: false,
          externalId: 'SNAP-001',
        }),
      });

      const snapRes = await app.request('/v1/ingest/pg/snap-bi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalPartnerReferenceNo: 'SNAP-001',
          originalReferenceNo: 'RRN-SNAP-777',
          latestTransactionStatus: '00',
          amount: { value: '42000.00', currency: 'IDR' },
        }),
      });
      expect(snapRes.status).toBe(200);
      const snapJson = (await snapRes.json()) as { matched: boolean; transaction: { paidVia: string } };
      expect(snapJson.matched).toBe(true);
      expect(snapJson.transaction.paidVia).toBe('snap-bi');

      // Midtrans
      await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: merchant.id,
          amount: 88000,
          useUniqueCode: false,
          externalId: 'MID-001',
        }),
      });

      const signatureKey = createHash('sha512')
        .update('MID-00120088000.00SB-Mid-server-TESTKEY')
        .digest('hex');

      const midRes = await app.request('/v1/ingest/pg/midtrans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: 'MID-001',
          status_code: '200',
          gross_amount: '88000.00',
          transaction_status: 'settlement',
          transaction_id: 'mid-trx-123',
          signature_key: signatureKey,
        }),
      });
      expect(midRes.status).toBe(200);
      const midJson = (await midRes.json()) as {
        matched: boolean;
        transaction: { status: string; paidVia: string };
      };
      expect(midJson.matched).toBe(true);
      expect(midJson.transaction.status).toBe('PAID');
      expect(midJson.transaction.paidVia).toBe('midtrans');
    } finally {
      if (prevMidtrans === undefined) delete process.env.MIDTRANS_SERVER_KEY;
      else process.env.MIDTRANS_SERVER_KEY = prevMidtrans;
      client.close();
    }
  });
});
