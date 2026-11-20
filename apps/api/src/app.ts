import { randomBytes, randomUUID } from 'node:crypto';
import {
  convertStaticToDynamic,
  renderQrDataUrl,
  renderQrSvg,
  validateCpmQr,
  validateQris,
  type FeeOption,
} from '@qris-dinamis/core';
import { and, desc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AppDatabase } from './db/client.js';
import { ingestEvents, merchants, transactions, webhookLogs } from './db/schema.js';
import { openApiSpec } from './openapi.js';
import {
  createMetricsRegistry,
  formatPrometheusMetrics,
  observabilityMiddleware,
} from './middleware/observability.js';
import { apiKeyAuth, getAuthMerchantId, rateLimiter } from './middleware/security.js';
import { transactionEvents } from './services/events.js';
import { bufferFromBase64, decodeQrisFromBuffer } from './services/qr-decoder.js';
import {
  allocateUniqueCode,
  cancelTransaction,
  markTransactionPaid,
  refundTransaction,
} from './services/transaction.js';
import { retryFailedWebhooks, retryWebhookById } from './services/webhook.js';
import { resolveCpmAcquirer } from './verifiers/cpm-acquirer.js';
import { verifierRegistry } from './verifiers/notification-parser.js';
import {
  parseDokuPayload,
  parseMidtransPayload,
  parseSnapBiPayload,
  verifyDokuSignature,
  verifyMidtransSignature,
  type PgExtractedPayment,
  type PgProvider,
} from './verifiers/pg-adapters.js';

async function readImageInput(c: {
  req: {
    header: (name: string) => string | undefined;
    parseBody: () => Promise<Record<string, unknown>>;
    json: () => Promise<unknown>;
  };
}): Promise<{ buffer: Buffer; fields: Record<string, unknown> }> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof file === 'string' || typeof (file as File).arrayBuffer !== 'function') {
      throw new Error('Missing "file" field in multipart/form-data');
    }
    const ab = await (file as File).arrayBuffer();
    return { buffer: Buffer.from(ab), fields: body };
  }

  const json = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json || typeof json.imageBase64 !== 'string') {
    throw new Error('Provide either multipart/form-data "file" or JSON "imageBase64"');
  }
  return { buffer: bufferFromBase64(json.imageBase64), fields: json };
}

const feeSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('none') }),
    z.object({ type: z.literal('prompt') }),
    z.object({ type: z.literal('fixed'), value: z.number().positive() }),
    z.object({ type: z.literal('percentage'), value: z.number().positive().max(100) }),
  ])
  .optional();

const createMerchantSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  staticQris: z.string().min(20),
  webhookUrl: z.string().url().optional().or(z.literal('')),
  webhookSecret: z.string().min(8).optional(),
});

const updateMerchantSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  webhookUrl: z.string().url().nullable().optional().or(z.literal('')),
  webhookSecret: z.string().min(8).optional(),
  isActive: z.boolean().optional(),
});

const convertQrisSchema = z.object({
  staticQris: z.string().min(20),
  amount: z.number().positive(),
  fee: feeSchema,
});

const generateQrisSchema = z.object({
  merchantId: z.string().min(1),
  amount: z.number().int().positive(),
  useUniqueCode: z.boolean().default(true),
  fee: feeSchema,
  ttlSeconds: z.number().int().min(60).max(86400).default(900),
  externalId: z.string().max(120).optional(),
  idempotencyKey: z.string().max(120).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ingestNotificationSchema = z.object({
  merchantId: z.string().min(1),
  source: z.string().min(1).default('android-notif'),
  amount: z.number().positive().optional(),
  text: z.string().optional(),
  reference: z.string().optional(),
  raw: z.record(z.unknown()).optional(),
});

const parsePreviewSchema = ingestNotificationSchema.omit({ merchantId: true });

const simulatePaySchema = z.object({
  transactionId: z.string().min(1),
});

const cpmValidateSchema = z.object({
  qrData: z.string().min(1),
});

const cpmPaySchema = z.object({
  merchantId: z.string().min(1),
  amount: z.number().int().positive(),
  qrData: z.string().min(1),
  externalId: z.string().max(120).optional(),
  idempotencyKey: z.string().max(120).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const rotateKeysSchema = z
  .object({
    rotateApiKey: z.boolean().default(true),
    rotateWebhookSecret: z.boolean().default(true),
  })
  .default({});

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function createApp(db: AppDatabase) {
  const app = new Hono();
  const metrics = createMetricsRegistry();

  app.use(
    '*',
    cors({
      origin: process.env.CORS_ORIGIN ?? '*',
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Api-Key', 'Authorization', 'X-Request-Id'],
    }),
  );

  app.use('*', observabilityMiddleware(metrics));
  app.use('*', rateLimiter());
  const requireApiKey = apiKeyAuth(db);

  app.get('/health', (c) =>
    c.json({ ok: true, service: 'qris-dinamis-api', timestamp: new Date().toISOString() }),
  );

  app.get('/metrics', async (c) => {
    const rows = await db.select({ status: transactions.status }).from(transactions);
    const txCounts: Record<string, number> = {
      PENDING: 0,
      PAID: 0,
      EXPIRED: 0,
      FAILED: 0,
      CANCELLED: 0,
      REFUNDED: 0,
    };
    for (const r of rows) {
      txCounts[r.status] = (txCounts[r.status] ?? 0) + 1;
    }
    c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return c.body(formatPrometheusMetrics(metrics, txCounts));
  });

  app.get('/openapi.json', (c) => c.json(openApiSpec));

  app.get('/docs', (c) =>
    c.html(`<!doctype html>
<html>
  <head>
    <title>QRIS Dinamis API Docs</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`),
  );

  // --- Merchants ---
  app.post('/v1/merchants', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createMerchantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }

    const validation = validateQris(parsed.data.staticQris);
    if (!validation.valid) {
      return c.json({ error: `Invalid static QRIS: ${validation.errors.join('; ')}` }, 400);
    }

    const now = new Date().toISOString();
    const id = `mrc_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const apiKey = `qris_live_${randomBytes(18).toString('hex')}`;
    const webhookSecret = parsed.data.webhookSecret ?? `whsec_${randomBytes(18).toString('hex')}`;

    const [merchant] = await db
      .insert(merchants)
      .values({
        id,
        name: parsed.data.name ?? validation.merchant?.name ?? 'Unnamed Merchant',
        staticQris: parsed.data.staticQris.trim(),
        nmid: validation.merchant?.nmid ?? null,
        city: validation.merchant?.city ?? null,
        webhookUrl: parsed.data.webhookUrl || null,
        webhookSecret,
        apiKey,
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return c.json({ merchant }, 201);
  });

  app.get('/v1/merchants', async (c) => {
    const rows = await db.select().from(merchants).orderBy(desc(merchants.createdAt));
    return c.json({ merchants: rows });
  });

  app.get('/v1/merchants/:id', async (c) => {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, c.req.param('id')));
    if (!merchant) return c.json({ error: 'Merchant not found' }, 404);
    return c.json({ merchant });
  });

  app.patch('/v1/merchants/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateMerchantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.webhookUrl !== undefined) updates.webhookUrl = parsed.data.webhookUrl || null;
    if (parsed.data.webhookSecret !== undefined) updates.webhookSecret = parsed.data.webhookSecret;
    if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive ? 1 : 0;

    const [updated] = await db
      .update(merchants)
      .set(updates)
      .where(eq(merchants.id, c.req.param('id')))
      .returning();

    if (!updated) return c.json({ error: 'Merchant not found' }, 404);
    return c.json({ merchant: updated });
  });

  app.delete('/v1/merchants/:id', async (c) => {
    const [deleted] = await db
      .delete(merchants)
      .where(eq(merchants.id, c.req.param('id')))
      .returning();
    if (!deleted) return c.json({ error: 'Merchant not found' }, 404);
    return c.json({ deleted: true, id: deleted.id });
  });

  app.get('/v1/merchants/:id/stats', requireApiKey, async (c) => {
    const id = c.req.param('id');
    const authMerchantId = getAuthMerchantId(c);
    if (authMerchantId && authMerchantId !== id) {
      return c.json({ error: 'Forbidden: API key does not belong to this merchant' }, 403);
    }
    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, id));
    if (!merchant) return c.json({ error: 'Merchant not found' }, 404);

    const rows = await db
      .select({
        status: transactions.status,
        baseAmount: transactions.baseAmount,
        uniqueCode: transactions.uniqueCode,
        totalAmount: transactions.totalAmount,
      })
      .from(transactions)
      .where(eq(transactions.merchantId, id));

    const counts = { PENDING: 0, PAID: 0, EXPIRED: 0, FAILED: 0 };
    let totalPaidAmount = 0;
    let totalUniqueCodeCollected = 0;

    for (const row of rows) {
      if (row.status in counts) {
        counts[row.status as keyof typeof counts]++;
      }
      if (row.status === 'PAID') {
        totalPaidAmount += row.totalAmount;
        totalUniqueCodeCollected += row.uniqueCode;
      }
    }

    const totalTransactions = rows.length;
    const conversionRate =
      totalTransactions > 0 ? Number(((counts.PAID / totalTransactions) * 100).toFixed(2)) : 0;

    return c.json({
      merchantId: id,
      totalTransactions,
      counts,
      totalPaidAmount,
      totalUniqueCodeCollected,
      conversionRate,
    });
  });

  app.post('/v1/merchants/:id/rotate-keys', requireApiKey, async (c) => {
    const id = c.req.param('id');
    const authMerchantId = getAuthMerchantId(c);
    if (authMerchantId && authMerchantId !== id) {
      return c.json({ error: 'Forbidden: API key does not belong to this merchant' }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = rotateKeysSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (parsed.data.rotateApiKey) {
      updates.apiKey = `qris_live_${randomBytes(18).toString('hex')}`;
    }
    if (parsed.data.rotateWebhookSecret) {
      updates.webhookSecret = `whsec_${randomBytes(20).toString('hex')}`;
    }

    const [updated] = await db.update(merchants).set(updates).where(eq(merchants.id, id)).returning();
    if (!updated) return c.json({ error: 'Merchant not found' }, 404);

    return c.json({
      merchant: updated,
      rotated: {
        apiKey: parsed.data.rotateApiKey,
        webhookSecret: parsed.data.rotateWebhookSecret,
      },
    });
  });

  app.post('/v1/merchants/upload', async (c) => {
    try {
      const { buffer, fields } = await readImageInput(c);
      const { staticQris, validation } = await decodeQrisFromBuffer(buffer);
      const name = typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : undefined;
      const webhookUrl =
        typeof fields.webhookUrl === 'string' && fields.webhookUrl.trim()
          ? fields.webhookUrl.trim()
          : null;
      const webhookSecret =
        typeof fields.webhookSecret === 'string' && fields.webhookSecret.length >= 8
          ? fields.webhookSecret
          : `whsec_${randomBytes(18).toString('hex')}`;

      const now = new Date().toISOString();
      const id = `mrc_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const apiKey = `qris_live_${randomBytes(18).toString('hex')}`;

      const [merchant] = await db
        .insert(merchants)
        .values({
          id,
          name: name ?? validation.merchant?.name ?? 'Unnamed Merchant',
          staticQris,
          nmid: validation.merchant?.nmid ?? null,
          city: validation.merchant?.city ?? null,
          webhookUrl,
          webhookSecret,
          apiKey,
          isActive: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return c.json({ merchant, decodedStaticQris: staticQris }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to upload QRIS image' }, 400);
    }
  });

  // --- Image Decode & Convert ---
  app.post('/v1/qris/decode-image', async (c) => {
    try {
      const { buffer } = await readImageInput(c);
      const { staticQris, validation } = await decodeQrisFromBuffer(buffer);
      return c.json({
        valid: validation.valid,
        isDynamic: validation.isDynamic,
        staticQris,
        merchant: validation.merchant,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to decode QRIS image' }, 400);
    }
  });

  app.post('/v1/qris/convert-image', async (c) => {
    try {
      const { buffer, fields } = await readImageInput(c);
      const rawAmount = typeof fields.amount === 'string' ? Number(fields.amount) : fields.amount;
      if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount) || rawAmount <= 0) {
        return c.json({ error: 'Valid positive "amount" is required' }, 400);
      }

      let fee: FeeOption | undefined;
      if (fields.fee && typeof fields.fee === 'object') {
        fee = fields.fee as FeeOption;
      } else if (typeof fields.feeType === 'string' && fields.feeType !== 'none') {
        if (fields.feeType === 'prompt') fee = { type: 'prompt' };
        else if (fields.feeType === 'fixed') fee = { type: 'fixed', value: Number(fields.feeValue) };
        else if (fields.feeType === 'percentage') fee = { type: 'percentage', value: Number(fields.feeValue) };
      }

      const { staticQris } = await decodeQrisFromBuffer(buffer);
      const converted = convertStaticToDynamic(staticQris, { amount: rawAmount, fee });
      const [qrSvg, qrDataUrl] = await Promise.all([
        renderQrSvg(converted.dynamicQris),
        renderQrDataUrl(converted.dynamicQris),
      ]);

      return c.json({ staticQris, ...converted, qrSvg, qrDataUrl });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to convert QRIS image' }, 400);
    }
  });

  // --- Stateless Convert ---
  app.post('/v1/qris/convert', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = convertQrisSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }

    try {
      const converted = convertStaticToDynamic(parsed.data.staticQris, {
        amount: parsed.data.amount,
        fee: parsed.data.fee as FeeOption | undefined,
      });
      const [qrSvg, qrDataUrl] = await Promise.all([
        renderQrSvg(converted.dynamicQris),
        renderQrDataUrl(converted.dynamicQris),
      ]);
      return c.json({ ...converted, qrSvg, qrDataUrl });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Conversion failed' }, 400);
    }
  });

  // --- Customer-Presented Mode (CPM) Validation & Acquirer Payment ---
  app.post('/v1/qris/cpm/validate', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = cpmValidateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }
    const result = validateCpmQr(parsed.data.qrData);
    return c.json(result);
  });

  app.post('/v1/qris/cpm/pay', requireApiKey, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = cpmPaySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }

    const input = parsed.data;
    const authMerchantId = getAuthMerchantId(c);
    if (authMerchantId && authMerchantId !== input.merchantId) {
      return c.json({ error: 'Forbidden: API key does not belong to this merchant' }, 403);
    }
    if (input.idempotencyKey) {
      const [existing] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.idempotencyKey, input.idempotencyKey));
      if (existing) {
        return c.json({
          approved: existing.status === 'PAID',
          wallet: null,
          transaction: existing,
          webhookTriggered: false,
          idempotentReplay: true,
        });
      }
    }

    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, input.merchantId));
    if (!merchant || merchant.isActive !== 1) {
      return c.json({ error: 'Active merchant not found' }, 404);
    }

    const validation = validateCpmQr(input.qrData);
    if (!validation.valid) {
      return c.json({ error: validation.errors.join('; ') }, 400);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 300_000).toISOString();
    const txId = `tx_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const [created] = await db
      .insert(transactions)
      .values({
        id: txId,
        merchantId: merchant.id,
        externalId: input.externalId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        mode: 'CPM',
        baseAmount: input.amount,
        uniqueCode: 0,
        totalAmount: input.amount,
        feeType: 'none',
        feeValue: null,
        dynamicQris: `CPM:${validation.format}:${validation.maskedToken ?? '****'}`,
        status: 'PENDING',
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
        expiresAt,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .returning();

    const acquirer = resolveCpmAcquirer();
    const authResult = await acquirer.authorizeAndPay({
      transactionId: created.id,
      merchantId: merchant.id,
      nmid: merchant.nmid,
      amount: input.amount,
      qrData: input.qrData,
      validation,
      externalId: input.externalId,
    });

    if (authResult.approved) {
      const { transaction, webhookTriggered } = await markTransactionPaid(db, created.id, {
        paidVia: authResult.acquirer,
        paidReference: authResult.reference,
      });
      return c.json({
        approved: true,
        wallet: validation.wallet,
        transaction: transaction ?? created,
        webhookTriggered,
      });
    }

    const [failedTx] = await db
      .update(transactions)
      .set({ status: 'FAILED', paidVia: authResult.acquirer, updatedAt: new Date().toISOString() })
      .where(eq(transactions.id, created.id))
      .returning();

    return c.json({
      approved: false,
      wallet: validation.wallet,
      reason: authResult.failureReason ?? 'CPM payment declined',
      transaction: failedTx ?? created,
      webhookTriggered: false,
    });
  });

  // --- Stateful Dynamic QRIS Generation ---
  app.post('/v1/qris/generate', requireApiKey, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = generateQrisSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }

    const input = parsed.data;

    if (input.idempotencyKey) {
      const [existing] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.idempotencyKey, input.idempotencyKey));
      if (existing) {
        const [qrSvg, qrDataUrl] = await Promise.all([
          renderQrSvg(existing.dynamicQris),
          renderQrDataUrl(existing.dynamicQris),
        ]);
        return c.json({ transaction: { ...existing, qrSvg, qrDataUrl }, idempotentReplay: true }, 200);
      }
    }

    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, input.merchantId));
    if (!merchant || merchant.isActive !== 1) {
      return c.json({ error: 'Active merchant not found' }, 404);
    }

    let uniqueCode = 0;
    try {
      if (input.useUniqueCode) {
        uniqueCode = await allocateUniqueCode(db, merchant.id, input.amount);
      }
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Unique code allocation failed' }, 409);
    }

    const totalAmount = input.amount + uniqueCode;
    const feeOpt = input.fee as FeeOption | undefined;
    const converted = convertStaticToDynamic(merchant.staticQris, {
      amount: totalAmount,
      fee: feeOpt,
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString();
    const id = `tx_${randomUUID().replace(/-/g, '').slice(0, 18)}`;

    const [tx] = await db
      .insert(transactions)
      .values({
        id,
        merchantId: merchant.id,
        externalId: input.externalId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        baseAmount: input.amount,
        uniqueCode,
        totalAmount,
        feeType: feeOpt?.type ?? 'none',
        feeValue: feeOpt && 'value' in feeOpt ? feeOpt.value : null,
        dynamicQris: converted.dynamicQris,
        status: 'PENDING',
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
        expiresAt,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .returning();

    const [qrSvg, qrDataUrl] = await Promise.all([
      renderQrSvg(tx.dynamicQris),
      renderQrDataUrl(tx.dynamicQris),
    ]);

    return c.json({ transaction: { ...tx, qrSvg, qrDataUrl } }, 201);
  });

  app.get('/v1/qris', requireApiKey, async (c) => {
    const authMerchantId = getAuthMerchantId(c);
    const merchantId = authMerchantId ?? c.req.query('merchantId');
    const status = c.req.query('status');

    const conditions = [];
    if (merchantId) conditions.push(eq(transactions.merchantId, merchantId));
    if (status) conditions.push(eq(transactions.status, status));

    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(transactions)
            .where(and(...conditions))
            .orderBy(desc(transactions.createdAt))
            .limit(100)
        : await db.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(100);

    return c.json({ transactions: rows });
  });

  app.get('/v1/qris/export', requireApiKey, async (c) => {
    const authMerchantId = getAuthMerchantId(c);
    const merchantId = authMerchantId ?? c.req.query('merchantId');
    const status = c.req.query('status');
    const format = c.req.query('format') === 'csv' ? 'csv' : 'json';

    const conditions = [];
    if (merchantId) conditions.push(eq(transactions.merchantId, merchantId));
    if (status) conditions.push(eq(transactions.status, status));

    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(transactions)
            .where(and(...conditions))
            .orderBy(desc(transactions.createdAt))
            .limit(1000)
        : await db.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(1000);

    if (format === 'json') {
      c.header('Content-Disposition', 'attachment; filename="qris-transactions.json"');
      return c.json({ transactions: rows });
    }

    const headers = [
      'id',
      'merchantId',
      'externalId',
      'baseAmount',
      'uniqueCode',
      'totalAmount',
      'status',
      'paidVia',
      'paidReference',
      'paidAt',
      'expiresAt',
      'createdAt',
    ];
    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.id,
          r.merchantId,
          r.externalId,
          r.baseAmount,
          r.uniqueCode,
          r.totalAmount,
          r.status,
          r.paidVia,
          r.paidReference,
          r.paidAt,
          r.expiresAt,
          r.createdAt,
        ]
          .map(escapeCsvCell)
          .join(','),
      ),
    ];

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="qris-transactions.csv"');
    return c.body(lines.join('\n'));
  });

  app.post('/v1/qris/:id/cancel', requireApiKey, async (c) => {
    const id = c.req.param('id');
    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) return c.json({ error: 'Transaction not found' }, 404);
    const authMerchantId = getAuthMerchantId(c);
    if (authMerchantId && authMerchantId !== existing.merchantId) {
      return c.json({ error: 'Forbidden: API key does not belong to this merchant' }, 403);
    }
    if (existing.status !== 'PENDING') {
      return c.json({ error: `Cannot cancel transaction with status ${existing.status}` }, 409);
    }
    const result = await cancelTransaction(db, id);
    return c.json(result);
  });

  app.post('/v1/qris/:id/refund', requireApiKey, async (c) => {
    const id = c.req.param('id');
    const [existing] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!existing) return c.json({ error: 'Transaction not found' }, 404);
    const authMerchantId = getAuthMerchantId(c);
    if (authMerchantId && authMerchantId !== existing.merchantId) {
      return c.json({ error: 'Forbidden: API key does not belong to this merchant' }, 403);
    }
    if (existing.status !== 'PAID') {
      return c.json({ error: `Only PAID transactions can be refunded (current: ${existing.status})` }, 409);
    }
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const result = await refundTransaction(db, id, typeof body.reason === 'string' ? body.reason : undefined);
    return c.json(result);
  });

  app.get('/v1/qris/:id', requireApiKey, async (c) => {
    const [tx] = await db.select().from(transactions).where(eq(transactions.id, c.req.param('id')));
    if (!tx) return c.json({ error: 'Transaction not found' }, 404);

    const [merchant] = await db.select({ name: merchants.name }).from(merchants).where(eq(merchants.id, tx.merchantId));
    const [qrSvg, qrDataUrl] = await Promise.all([
      renderQrSvg(tx.dynamicQris),
      renderQrDataUrl(tx.dynamicQris),
    ]);

    return c.json({
      transaction: {
        ...tx,
        merchantName: merchant?.name ?? null,
        qrSvg,
        qrDataUrl,
      },
    });
  });

  app.get('/v1/transactions/:id/events', async (c) => {
    const id = c.req.param('id');
    const [tx] = await db.select().from(transactions).where(eq(transactions.id, id));
    if (!tx) return c.json({ error: 'Transaction not found' }, 404);

    return streamSSE(c, async (stream) => {
      const initialEvent = {
        transactionId: tx.id,
        merchantId: tx.merchantId,
        status: tx.status,
        totalAmount: tx.totalAmount,
        paidVia: tx.paidVia,
        paidReference: tx.paidReference,
        paidAt: tx.paidAt,
        expiresAt: tx.expiresAt,
        updatedAt: tx.updatedAt,
      };
      await stream.writeSSE({
        event: 'status',
        data: JSON.stringify(initialEvent),
      });

      if (tx.status === 'PAID' || tx.status === 'EXPIRED') {
        return;
      }

      await new Promise<void>((resolve) => {
        let closed = false;
        const finish = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          resolve();
        };

        const unsubscribe = transactionEvents.subscribe(id, async (event) => {
          try {
            await stream.writeSSE({
              event: 'status',
              data: JSON.stringify(event),
            });
            if (event.status === 'PAID' || event.status === 'EXPIRED') {
              finish();
            }
          } catch {
            finish();
          }
        });

        const heartbeat = setInterval(() => {
          stream.writeSSE({ event: 'ping', data: '{}' }).catch(finish);
        }, 20_000);

        stream.onAbort(finish);
      });
    });
  });

  // --- Pluggable Payment Notification Ingest ---
  app.get('/v1/ingest/adapters', (c) => {
    return c.json({ adapters: verifierRegistry.listAdapters() });
  });

  app.get('/v1/ingest/events', requireApiKey, async (c) => {
    const merchantId = c.req.query('merchantId');
    const status = c.req.query('status');
    const conditions = [];
    if (merchantId) conditions.push(eq(ingestEvents.merchantId, merchantId));
    if (status) conditions.push(eq(ingestEvents.status, status));

    const events =
      conditions.length > 0
        ? await db
            .select()
            .from(ingestEvents)
            .where(and(...conditions))
            .orderBy(desc(ingestEvents.createdAt))
            .limit(50)
        : await db.select().from(ingestEvents).orderBy(desc(ingestEvents.createdAt)).limit(50);

    return c.json({ events });
  });

  app.post('/v1/ingest/pg/:provider', async (c) => {
    const provider = c.req.param('provider') as PgProvider;
    if (provider !== 'doku' && provider !== 'snap-bi' && provider !== 'midtrans') {
      return c.json({ error: `Unsupported PG provider "${provider}". Use doku, snap-bi, or midtrans.` }, 400);
    }

    const rawBody = await c.req.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    if (provider === 'doku' && process.env.DOKU_SECRET_KEY) {
      const sig = c.req.header('Signature') ?? '';
      const valid = verifyDokuSignature({
        secretKey: process.env.DOKU_SECRET_KEY,
        clientId: c.req.header('Client-Id') ?? '',
        requestId: c.req.header('Request-Id') ?? '',
        requestTimestamp: c.req.header('Request-Timestamp') ?? '',
        requestTarget: new URL(c.req.url).pathname,
        rawBody,
        signatureHeader: sig,
      });
      if (!valid) return c.json({ error: 'Invalid DOKU signature' }, 401);
    }

    if (provider === 'midtrans' && process.env.MIDTRANS_SERVER_KEY) {
      const valid = verifyMidtransSignature({
        serverKey: process.env.MIDTRANS_SERVER_KEY,
        orderId: String(body.order_id ?? ''),
        statusCode: String(body.status_code ?? ''),
        grossAmount: String(body.gross_amount ?? ''),
        signatureKey: String(body.signature_key ?? ''),
      });
      if (!valid) return c.json({ error: 'Invalid Midtrans signature' }, 401);
    }

    let extracted: PgExtractedPayment | null = null;
    if (provider === 'doku') extracted = parseDokuPayload(body);
    else if (provider === 'snap-bi') extracted = parseSnapBiPayload(body);
    else extracted = parseMidtransPayload(body);

    if (!extracted) {
      return c.json({ matched: false, reason: 'Could not parse PG payment payload' }, 400);
    }
    if (!extracted.isPaid) {
      return c.json({ matched: false, reason: 'Notification status is not paid/settled' }, 200);
    }

    const nowIso = new Date().toISOString();
    const merchantIdQuery = c.req.query('merchantId');

    // Match by externalId first, otherwise fallback to merchantId + exact totalAmount
    const [candidate] = extracted.externalId
      ? await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.externalId, extracted.externalId),
              eq(transactions.status, 'PENDING'),
              gt(transactions.expiresAt, nowIso),
            ),
          )
          .limit(1)
      : merchantIdQuery
        ? await db
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.merchantId, merchantIdQuery),
                eq(transactions.status, 'PENDING'),
                eq(transactions.totalAmount, extracted.amount),
                gt(transactions.expiresAt, nowIso),
              ),
            )
            .limit(1)
        : [];

    if (!candidate) {
      return c.json({ matched: false, extractedAmount: extracted.amount, externalId: extracted.externalId ?? null }, 200);
    }

    const { transaction, webhookTriggered } = await markTransactionPaid(db, candidate.id, {
      paidVia: provider,
      paidReference: extracted.reference ?? null,
    });

    await db.insert(ingestEvents).values({
      id: `ing_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      merchantId: candidate.merchantId,
      source: `pg:${provider}`,
      rawPayload: rawBody,
      extractedAmount: extracted.amount,
      matchedTransactionId: transaction?.id ?? candidate.id,
      status: transaction ? 'MATCHED' : 'DUPLICATE',
      createdAt: nowIso,
    });

    return c.json({
      matched: Boolean(transaction),
      provider,
      extractedAmount: extracted.amount,
      transaction,
      webhookTriggered,
    });
  });

  app.post('/v1/ingest/parse-preview', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parsePreviewSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }
    const extracted = verifierRegistry.extract(parsed.data);
    return c.json({ extracted });
  });

  app.post('/v1/ingest/notification', requireApiKey, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ingestNotificationSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }

    const input = parsed.data;
    const authMerchantId = getAuthMerchantId(c);
    if (authMerchantId && authMerchantId !== input.merchantId) {
      return c.json({ error: 'Forbidden: API key does not belong to this merchant' }, 403);
    }
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, input.merchantId));
    if (!merchant) return c.json({ error: 'Merchant not found' }, 404);

    const extracted = verifierRegistry.extract(input);
    const nowIso = new Date().toISOString();

    if (!extracted) {
      await db.insert(ingestEvents).values({
        id: `ing_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        merchantId: merchant.id,
        source: input.source,
        rawPayload: JSON.stringify(input),
        extractedAmount: null,
        matchedTransactionId: null,
        status: 'UNMATCHED',
        createdAt: nowIso,
      });
      return c.json({ matched: false, reason: 'Could not extract payment amount from payload' }, 200);
    }

    // Match oldest active PENDING non-expired transaction with exact totalAmount
    const [candidate] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.merchantId, merchant.id),
          eq(transactions.status, 'PENDING'),
          eq(transactions.totalAmount, extracted.amount),
          gt(transactions.expiresAt, nowIso),
        ),
      )
      .limit(1);

    if (!candidate) {
      await db.insert(ingestEvents).values({
        id: `ing_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        merchantId: merchant.id,
        source: input.source,
        rawPayload: JSON.stringify(input),
        extractedAmount: extracted.amount,
        matchedTransactionId: null,
        status: 'UNMATCHED',
        createdAt: nowIso,
      });
      return c.json({ matched: false, extractedAmount: extracted.amount }, 200);
    }

    const { transaction, webhookTriggered } = await markTransactionPaid(db, candidate.id, {
      paidVia: extracted.source,
      paidReference: extracted.reference ?? null,
    });

    await db.insert(ingestEvents).values({
      id: `ing_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      merchantId: merchant.id,
      source: input.source,
      rawPayload: JSON.stringify(input),
      extractedAmount: extracted.amount,
      matchedTransactionId: transaction?.id ?? candidate.id,
      status: transaction ? 'MATCHED' : 'DUPLICATE',
      createdAt: nowIso,
    });

    return c.json({
      matched: Boolean(transaction),
      extractedAmount: extracted.amount,
      adapter: extracted.adapter ?? null,
      reference: extracted.reference ?? null,
      transaction,
      webhookTriggered,
    });
  });

  // --- Sandbox Payment Simulator ---
  app.post('/v1/sandbox/simulate-pay', requireApiKey, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = simulatePaySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }

    const [existing] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, parsed.data.transactionId));
    if (!existing) return c.json({ error: 'Transaction not found' }, 404);
    if (existing.status !== 'PENDING') {
      return c.json({ error: `Transaction is already ${existing.status}` }, 409);
    }

    const result = await markTransactionPaid(db, existing.id, {
      paidVia: 'sandbox-simulator',
      paidReference: `SIM-${Date.now()}`,
    });

    return c.json(result);
  });

  // --- Webhook Logs & Manual Retry ---
  app.use('/v1/webhooks/*', requireApiKey);

  app.get('/v1/webhooks/logs', async (c) => {
    const authMerchantId = getAuthMerchantId(c);
    const merchantId = authMerchantId ?? c.req.query('merchantId');
    const logs = merchantId
      ? await db
          .select()
          .from(webhookLogs)
          .where(eq(webhookLogs.merchantId, merchantId))
          .orderBy(desc(webhookLogs.createdAt))
          .limit(100)
      : await db.select().from(webhookLogs).orderBy(desc(webhookLogs.createdAt)).limit(100);
    return c.json({ logs });
  });

  app.post('/v1/webhooks/retry-failed', async (c) => {
    const authMerchantId = getAuthMerchantId(c);
    const merchantId = authMerchantId ?? c.req.query('merchantId');
    const retriedCount = await retryFailedWebhooks(db, merchantId);
    return c.json({ retriedCount });
  });

  app.post('/v1/webhooks/:id/retry', async (c) => {
    const updated = await retryWebhookById(db, c.req.param('id'));
    if (!updated) return c.json({ error: 'Webhook log not found' }, 404);
    return c.json({ log: updated });
  });

  return app;
}
