import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type PgProvider = 'doku' | 'snap-bi' | 'midtrans';

export interface PgExtractedPayment {
  provider: PgProvider;
  amount: number;
  externalId?: string;
  reference?: string;
  isPaid: boolean;
}

function safeTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseAmountValue(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw === 'string') {
    const num = Number.parseFloat(raw.replace(/,/g, ''));
    if (Number.isFinite(num) && num > 0) {
      return Math.round(num);
    }
  }
  return null;
}

/**
 * Verifies DOKU Checkout HMAC-SHA256 notification signature.
 * Component string:
 *   Client-Id:<clientId>\nRequest-Id:<requestId>\nRequest-Timestamp:<timestamp>\nRequest-Target:<target>\nDigest:<base64Sha256>
 */
export function verifyDokuSignature(params: {
  secretKey: string;
  clientId: string;
  requestId: string;
  requestTimestamp: string;
  requestTarget: string;
  rawBody: string;
  signatureHeader: string;
}): boolean {
  const digest = createHash('sha256').update(params.rawBody).digest('base64');
  const component = [
    `Client-Id:${params.clientId}`,
    `Request-Id:${params.requestId}`,
    `Request-Timestamp:${params.requestTimestamp}`,
    `Request-Target:${params.requestTarget}`,
    `Digest:${digest}`,
  ].join('\n');

  const expected = `HMACSHA256=${createHmac('sha256', params.secretKey).update(component).digest('base64')}`;
  return safeTimingEqual(expected, params.signatureHeader.trim());
}

/**
 * Verifies Midtrans SHA-512 notification signature:
 *   SHA512(order_id + status_code + gross_amount + serverKey)
 */
export function verifyMidtransSignature(params: {
  serverKey: string;
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
}): boolean {
  const expected = createHash('sha512')
    .update(`${params.orderId}${params.statusCode}${params.grossAmount}${params.serverKey}`)
    .digest('hex');
  return safeTimingEqual(expected, params.signatureKey.trim().toLowerCase());
}

export function parseDokuPayload(body: Record<string, unknown>): PgExtractedPayment | null {
  const order = (body.order ?? {}) as Record<string, unknown>;
  const transaction = (body.transaction ?? {}) as Record<string, unknown>;

  const amount = parseAmountValue(order.amount);
  if (amount === null) return null;

  const status = String(transaction.status ?? '').toUpperCase();
  return {
    provider: 'doku',
    amount,
    externalId: typeof order.invoice_number === 'string' ? order.invoice_number : undefined,
    reference:
      typeof transaction.original_request_id === 'string'
        ? transaction.original_request_id
        : typeof order.invoice_number === 'string'
          ? order.invoice_number
          : undefined,
    isPaid: status === 'SUCCESS' || status === 'PAID',
  };
}

export function parseSnapBiPayload(body: Record<string, unknown>): PgExtractedPayment | null {
  const amountObj = (body.amount ?? {}) as Record<string, unknown>;
  const amount = parseAmountValue(amountObj.value ?? body.amount);
  if (amount === null) return null;

  const txStatus = String(body.latestTransactionStatus ?? '');
  const externalId =
    typeof body.originalPartnerReferenceNo === 'string' ? body.originalPartnerReferenceNo : undefined;
  const reference =
    typeof body.originalReferenceNo === 'string' ? body.originalReferenceNo : externalId;

  return {
    provider: 'snap-bi',
    amount,
    externalId,
    reference,
    isPaid: txStatus === '00',
  };
}

export function parseMidtransPayload(body: Record<string, unknown>): PgExtractedPayment | null {
  const amount = parseAmountValue(body.gross_amount);
  if (amount === null) return null;

  const txStatus = String(body.transaction_status ?? '').toLowerCase();
  const fraudStatus = String(body.fraud_status ?? 'accept').toLowerCase();
  const isPaid =
    txStatus === 'settlement' || (txStatus === 'capture' && fraudStatus !== 'challenge' && fraudStatus !== 'deny');

  return {
    provider: 'midtrans',
    amount,
    externalId: typeof body.order_id === 'string' ? body.order_id : undefined,
    reference: typeof body.transaction_id === 'string' ? body.transaction_id : undefined,
    isPaid,
  };
}
