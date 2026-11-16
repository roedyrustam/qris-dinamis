import net from 'node:net';
import { computeCrc16, QrisDinamisClient } from '@qris-dinamis/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDb } from '../db/client.js';
import { RedisEventTransport, type TransactionStatusEvent } from '../services/events.js';

function buildStaticQris(): string {
  const body =
    '00020101021126670015ID.CO.GOPAY.WWW01189360089800012345670215ID10200300405060303UMI5204549953033605802ID5914WARUNG DIGITAL6007JAKARTA6304';
  return `${body}${computeCrc16(body)}`;
}

describe('E2E Full-Stack Flow & RedisEventTransport', () => {
  it('runs complete merchant -> generate -> SSE -> BSI ingest -> stats -> export -> ingest events flow', async () => {
    const { db, client: dbClient } = await createDb('file::memory:');
    try {
      const app = createApp(db);

      const sdk = new QrisDinamisClient({
        baseUrl: 'http://localhost',
        fetchImpl: async (input, init) => app.request(String(input), init),
      });

      // 1. Register merchant
      const { merchant } = await sdk.createMerchant({ staticQris: buildStaticQris() });
      const merchantId = String(merchant.id);

      // 2. Generate dynamic QRIS with unique code
      const { transaction } = await sdk.generateQris({
        merchantId,
        amount: 70000,
        useUniqueCode: true,
        externalId: 'E2E-ORDER-1',
      });
      expect(transaction.status).toBe('PENDING');

      // 3. Open SSE stream and wait for BSI notification ingest
      const sseRes = await app.request(`/v1/transactions/${transaction.id}/events`);
      expect(sseRes.status).toBe(200);
      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();

      const initialChunk = decoder.decode((await reader.read()).value);
      expect(initialChunk).toContain('"status":"PENDING"');

      // 4. Ingest BSI BYOND notification matching totalAmount
      const formattedTotal = transaction.totalAmount.toLocaleString('id-ID');
      const ingestRes = await sdk.ingestNotification({
        merchantId,
        source: 'android-notif',
        text: `BYOND by BSI: Pembayaran QRIS Rp ${formattedTotal} berhasil Ref: FT7788`,
      });
      expect(ingestRes.matched).toBe(true);
      expect(ingestRes.adapter).toBe('bsi');

      const paidChunk = decoder.decode((await reader.read()).value);
      expect(paidChunk).toContain('"status":"PAID"');

      // 5. Verify merchant stats, CSV export, and /v1/ingest/events
      const stats = await sdk.getMerchantStats(merchantId);
      expect(stats.counts.PAID).toBe(1);
      expect(stats.totalPaidAmount).toBe(transaction.totalAmount);
      expect(stats.conversionRate).toBe(100);

      const eventsRes = await app.request(`/v1/ingest/events?merchantId=${merchantId}`);
      expect(eventsRes.status).toBe(200);
      const eventsJson = (await eventsRes.json()) as { events: Array<{ status: string }> };
      expect(eventsJson.events[0]?.status).toBe('MATCHED');
    } finally {
      dbClient.close();
    }
  });

  it('publishes and receives TransactionStatusEvent via RedisEventTransport RESP2', async () => {
    const subscribers: net.Socket[] = [];
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        if (buf.includes('PSUBSCRIBE')) {
          subscribers.push(socket);
          socket.write('*3\r\n$10\r\npsubscribe\r\n$8\r\nqris:tx:\r\n:1\r\n');
          buf = '';
        } else if (buf.includes('PUBLISH')) {
          const lines = buf.split('\r\n');
          const channel = lines[4] ?? '';
          const payload = lines[6] ?? '';
          if (channel && payload) {
            const pattern = 'qris:tx:*';
            const msg =
              `*4\r\n$8\r\npmessage\r\n$${Buffer.byteLength(pattern)}\r\n${pattern}\r\n` +
              `$${Buffer.byteLength(channel)}\r\n${channel}\r\n` +
              `$${Buffer.byteLength(payload)}\r\n${payload}\r\n`;
            for (const sub of subscribers) {
              sub.write(msg);
            }
          }
          socket.write(':1\r\n');
          buf = '';
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const transport = new RedisEventTransport(`redis://127.0.0.1:${port}`);

    try {
      const received = await new Promise<TransactionStatusEvent>((resolve) => {
        transport.subscribe('tx_redis_1', resolve);
        setTimeout(() => {
          transport.publish({
            transactionId: 'tx_redis_1',
            merchantId: 'm_1',
            status: 'PAID',
            totalAmount: 50123,
            expiresAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }, 50);
      });

      expect(received.transactionId).toBe('tx_redis_1');
      expect(received.status).toBe('PAID');
      expect(received.totalAmount).toBe(50123);
    } finally {
      await transport.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
