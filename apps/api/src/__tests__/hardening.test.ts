import {
  computeCrc16,
  createWebhookHandler,
  signWebhookPayload,
} from '@qris-dinamis/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createDb } from '../db/client.js';
import { isBlockedWebhookUrl } from '../services/webhook.js';

function buildStaticQris(): string {
  const body =
    '00020101021126670015ID.CO.GOPAY.WWW01189360089800012345670215ID10200300405060303UMI5204549953033605802ID5914WARUNG DIGITAL6007JAKARTA6304';
  return `${body}${computeCrc16(body)}`;
}

describe('v2.1.0 Enterprise Hardening (SSRF, Cancel/Refund, Metrics, Webhook Handler)', () => {
  it('blocks private/loopback/metadata webhook URLs when SSRF protection is enabled', () => {
    const prev = process.env.ALLOW_PRIVATE_WEBHOOKS;
    process.env.ALLOW_PRIVATE_WEBHOOKS = 'false';
    try {
      expect(isBlockedWebhookUrl('http://127.0.0.1:8080/hook')).toContain('SSRF blocked');
      expect(isBlockedWebhookUrl('http://169.254.169.254/latest/meta-data')).toContain('SSRF blocked');
      expect(isBlockedWebhookUrl('http://10.0.0.5/internal')).toContain('SSRF blocked');
      expect(isBlockedWebhookUrl('http://localhost:3000/hook')).toContain('SSRF blocked');
      expect(isBlockedWebhookUrl('ftp://example.com/hook')).toContain('Blocked webhook protocol');
      expect(isBlockedWebhookUrl('https://merchant.example.com/webhooks/qris')).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.ALLOW_PRIVATE_WEBHOOKS;
      else process.env.ALLOW_PRIVATE_WEBHOOKS = prev;
    }
  });

  it('supports cancel (PENDING -> CANCELLED), refund (PAID -> REFUNDED), X-Request-Id, and /metrics', async () => {
    const { db, client } = await createDb('file::memory:');
    try {
      const app = createApp(db);

      const mRes = await app.request('/v1/merchants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQris: buildStaticQris() }),
      });
      expect(mRes.headers.get('X-Request-Id')).toMatch(/^req_/);
      const { merchant } = (await mRes.json()) as { merchant: { id: string } };

      // Cancel flow
      const g1 = await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: merchant.id, amount: 15000, useUniqueCode: false }),
      });
      const tx1 = ((await g1.json()) as { transaction: { id: string } }).transaction;

      const cancelRes = await app.request(`/v1/qris/${tx1.id}/cancel`, { method: 'POST' });
      expect(cancelRes.status).toBe(200);
      const cancelJson = (await cancelRes.json()) as { transaction: { status: string } };
      expect(cancelJson.transaction.status).toBe('CANCELLED');

      // Refund flow
      const g2 = await app.request('/v1/qris/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: merchant.id, amount: 25000, useUniqueCode: false }),
      });
      const tx2 = ((await g2.json()) as { transaction: { id: string } }).transaction;

      await app.request('/v1/sandbox/simulate-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: tx2.id }),
      });

      const refundRes = await app.request(`/v1/qris/${tx2.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Customer request' }),
      });
      expect(refundRes.status).toBe(200);
      const refundJson = (await refundRes.json()) as { transaction: { status: string } };
      expect(refundJson.transaction.status).toBe('REFUNDED');

      // Prometheus /metrics
      const metricsRes = await app.request('/metrics');
      expect(metricsRes.status).toBe(200);
      const metricsText = await metricsRes.text();
      expect(metricsText).toContain('qris_http_requests_total');
      expect(metricsText).toContain('qris_transactions_total{status="CANCELLED"} 1');
      expect(metricsText).toContain('qris_transactions_total{status="REFUNDED"} 1');

      // Bulk DLQ retry endpoint
      const dlqRes = await app.request('/v1/webhooks/retry-failed', { method: 'POST' });
      expect(dlqRes.status).toBe(200);
      const dlqJson = (await dlqRes.json()) as { retriedCount: number };
      expect(dlqJson.retriedCount).toBe(0);
    } finally {
      client.close();
    }
  });

  it('verifies framework-agnostic createWebhookHandler from @qris-dinamis/core', async () => {
    const secret = 'whsec_framework_test';
    const received: string[] = [];
    const handler = createWebhookHandler({
      secret,
      onEvent: (evt) => {
        received.push(evt.type);
      },
    });

    const rawBody = JSON.stringify({ id: 'evt_1', type: 'payment.paid', createdAt: new Date().toISOString(), data: {} });
    const sig = signWebhookPayload({ secret, timestamp: Math.floor(Date.now() / 1000), rawBody });

    const okRes = await handler(
      new Request('https://app.example.com/webhooks/qris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Qris-Signature': sig },
        body: rawBody,
      }),
    );
    expect(okRes.status).toBe(200);
    expect(received).toEqual(['payment.paid']);

    const badRes = await handler(
      new Request('https://app.example.com/webhooks/qris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Qris-Signature': 't=123,v1=bad' },
        body: rawBody,
      }),
    );
    expect(badRes.status).toBe(401);
  });
});
