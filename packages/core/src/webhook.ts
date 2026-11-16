import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignWebhookInput {
  secret: string;
  timestamp: number;
  rawBody: string;
}

export interface VerifyWebhookInput {
  secret: string;
  signatureHeader: string | undefined | null;
  rawBody: string;
  /** Maximum allowed clock skew in seconds (default: 300s). Set to 0 to disable. */
  toleranceSeconds?: number;
  nowSeconds?: number;
}

/**
 * Signs a webhook payload using HMAC-SHA256 (`t=<unix>,v1=<hex>`).
 */
export function signWebhookPayload({ secret, timestamp, rawBody }: SignWebhookInput): string {
  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/**
 * Verifies an incoming `X-Qris-Signature` header using constant-time comparison
 * and replay-attack timestamp tolerance.
 */
export function verifyWebhookSignature({
  secret,
  signatureHeader,
  rawBody,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifyWebhookInput): boolean {
  if (!signatureHeader || !secret) return false;

  const parts = Object.fromEntries(
    signatureHeader
      .split(',')
      .map((item) => item.trim().split('='))
      .filter(([k, v]) => Boolean(k && v)),
  );

  const timestamp = Number.parseInt(parts.t ?? '', 10);
  const v1 = parts.v1;

  if (!Number.isFinite(timestamp) || !v1) return false;

  if (toleranceSeconds > 0 && Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  const actualBuf = Buffer.from(v1, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');

  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}
