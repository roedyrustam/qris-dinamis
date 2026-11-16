import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDb } from '../db/client.js';
import { verifierRegistry } from '../verifiers/notification-parser.js';

describe('Bank & E-Wallet Notification Parser Suite', () => {
  const cases = [
    {
      name: 'BCA explicit source',
      source: 'mybca',
      text: 'Pembayaran QRIS BCA Rp 50.123,00 BERHASIL Ref: BCA99812',
      expectedAmount: 50123,
      expectedAdapter: 'bca',
      expectedRef: 'BCA99812',
    },
    {
      name: 'BRI / BRImo',
      source: 'brimo',
      text: 'BRImo: Dana masuk Rp125.450 dari QRIS No. Ref: BRI77123',
      expectedAmount: 125450,
      expectedAdapter: 'bri',
      expectedRef: 'BRI77123',
    },
    {
      name: 'Mandiri Livin Merchant',
      source: 'livin-merchant',
      text: "Livin' Merchant: Pembayaran QRIS IDR 75,000 berhasil diterima Approval: MDR001",
      expectedAmount: 75000,
      expectedAdapter: 'mandiri',
      expectedRef: 'MDR001',
    },
    {
      name: 'BNI wondr',
      source: 'wondr',
      text: 'wondr by BNI: Pembayaran QRIS masuk Rp 18.250 Jurnal: BNI5521',
      expectedAmount: 18250,
      expectedAdapter: 'bni',
      expectedRef: 'BNI5521',
    },
    {
      name: 'GoPay Merchant / GoBiz',
      source: 'gobiz',
      text: 'GoPay Merchant: Pembayaran QRIS Rp 32.100 diterima Order #GP-8821',
      expectedAmount: 32100,
      expectedAdapter: 'gopay',
      expectedRef: 'GP-8821',
    },
    {
      name: 'OVO Merchant',
      source: 'ovo-merchant',
      text: 'OVO Merchant: Anda menerima Rp44.500 dari pelanggan Trx: OVO1234',
      expectedAmount: 44500,
      expectedAdapter: 'ovo',
      expectedRef: 'OVO1234',
    },
    {
      name: 'DANA Bisnis',
      source: 'dana-bisnis',
      text: 'DANA Bisnis: Kamu menerima pembayaran QRIS Rp 99.999 Order: DN-772',
      expectedAmount: 99999,
      expectedAdapter: 'dana',
      expectedRef: 'DN-772',
    },
    {
      name: 'ShopeePay Partner',
      source: 'shopee-partner',
      text: 'ShopeePay: Pembayaran sebesar Rp 15.005 berhasil diterima SN: SP9001',
      expectedAmount: 15005,
      expectedAdapter: 'shopeepay',
      expectedRef: 'SP9001',
    },
  ];

  for (const tc of cases) {
    it(`extracts ${tc.name}`, () => {
      const result = verifierRegistry.extract({ source: tc.source, text: tc.text });
      expect(result).not.toBeNull();
      expect(result?.amount).toBe(tc.expectedAmount);
      expect(result?.adapter).toBe(tc.expectedAdapter);
      expect(result?.reference).toBe(tc.expectedRef);
    });
  }

  it('auto-detects bank/e-wallet adapter when source is android-notif', () => {
    const result = verifierRegistry.extract({
      source: 'android-notif',
      text: 'GoBiz: Pembayaran QRIS Rp 21.500 diterima Order #GP-1122',
    });
    expect(result).toEqual({
      amount: 21500,
      reference: 'GP-1122',
      source: 'android-notif',
      adapter: 'gopay',
    });
  });

  it('rejects outgoing / debit notifications to prevent false PAID transitions', () => {
    const result = verifierRegistry.extract({
      source: 'bca',
      text: 'Transfer ke BUDI Rp 50.123,00 BERHASIL Ref: OUT999',
    });
    expect(result).toBeNull();
  });

  it('exposes /v1/ingest/adapters and /v1/ingest/parse-preview endpoints', async () => {
    const { db, client } = await createDb(':memory:');
    try {
      const app = createApp(db);

      const adaptersRes = await app.request('/v1/ingest/adapters');
      expect(adaptersRes.status).toBe(200);
      const adaptersBody = (await adaptersRes.json()) as { adapters: Array<{ name: string }> };
      const names = adaptersBody.adapters.map((a) => a.name);
      expect(names).toEqual(
        expect.arrayContaining(['bca', 'bri', 'mandiri', 'bni', 'gopay', 'ovo', 'dana', 'shopeepay']),
      );

      const previewRes = await app.request('/v1/ingest/parse-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'auto',
          text: 'DANA Bisnis: Pembayaran QRIS Rp 65.432 Order: DN-1001',
        }),
      });
      expect(previewRes.status).toBe(200);
      const previewBody = (await previewRes.json()) as {
        extracted: { amount: number; adapter: string; reference: string } | null;
      };
      expect(previewBody.extracted).toEqual({
        amount: 65432,
        adapter: 'dana',
        reference: 'DN-1001',
        source: 'auto',
      });
    } finally {
      client.close();
    }
  });
});
