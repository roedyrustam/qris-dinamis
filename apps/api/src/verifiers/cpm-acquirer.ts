import { randomUUID } from 'node:crypto';
import type { CpmValidationResult } from '@qris-dinamis/core';

export interface CpmAuthorizationRequest {
  transactionId: string;
  merchantId: string;
  nmid: string | null;
  amount: number;
  qrData: string;
  validation: CpmValidationResult;
  externalId?: string | null;
}

export interface CpmAuthorizationResult {
  approved: boolean;
  acquirer: string;
  reference: string | null;
  failureReason?: string;
}

export interface CpmAcquirerAdapter {
  readonly name: string;
  authorizeAndPay(req: CpmAuthorizationRequest): Promise<CpmAuthorizationResult>;
}

/**
 * Default sandbox/local acquirer for QRIS Customer-Presented Mode (CPM).
 * Approves valid CPM QR payloads unless the token ends with "0000" (deterministic decline test).
 */
export class SandboxCpmAcquirer implements CpmAcquirerAdapter {
  readonly name = 'sandbox-cpm-acquirer';

  async authorizeAndPay(req: CpmAuthorizationRequest): Promise<CpmAuthorizationResult> {
    if (!req.validation.valid) {
      return {
        approved: false,
        acquirer: this.name,
        reference: null,
        failureReason: req.validation.errors.join('; ') || 'Invalid CPM QR payload',
      };
    }

    // Deterministic decline trigger for sandbox/QA testing
    if (req.qrData.trim().endsWith('0000')) {
      return {
        approved: false,
        acquirer: this.name,
        reference: null,
        failureReason: 'Issuer declined CPM transaction (sandbox test decline)',
      };
    }

    const walletTag = (req.validation.wallet ?? 'QRIS').toLowerCase();
    return {
      approved: true,
      acquirer: `cpm:${walletTag}`,
      reference: `CPM-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    };
  }
}

/**
 * SNAP BI / DANA QRIS CPM Acquirer bridge (active when CPM_ACQUIRER_URL is configured).
 */
export class SnapBiCpmAcquirer implements CpmAcquirerAdapter {
  readonly name = 'snap-bi-cpm-acquirer';
  private readonly endpointUrl: string;
  private readonly bearerToken?: string;

  constructor(endpointUrl: string, bearerToken?: string) {
    this.endpointUrl = endpointUrl;
    this.bearerToken = bearerToken;
  }

  async authorizeAndPay(req: CpmAuthorizationRequest): Promise<CpmAuthorizationResult> {
    const res = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
      },
      body: JSON.stringify({
        partnerReferenceNo: req.externalId ?? req.transactionId,
        merchantId: req.nmid ?? req.merchantId,
        scannedQrCode: req.qrData,
        amount: {
          value: req.amount.toFixed(2),
          currency: 'IDR',
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await res.json().catch(() => ({}))) as {
      responseCode?: string;
      responseMessage?: string;
      referenceNo?: string;
    };

    const approved = res.ok && (data.responseCode === '2006000' || data.responseCode === '00');
    return {
      approved,
      acquirer: 'snap-bi-cpm',
      reference: data.referenceNo ?? null,
      failureReason: approved ? undefined : data.responseMessage ?? `Acquirer HTTP ${res.status}`,
    };
  }
}

export function resolveCpmAcquirer(): CpmAcquirerAdapter {
  const endpoint = process.env.CPM_ACQUIRER_URL?.trim();
  if (endpoint) {
    return new SnapBiCpmAcquirer(endpoint, process.env.CPM_ACQUIRER_TOKEN?.trim());
  }
  return new SandboxCpmAcquirer();
}
