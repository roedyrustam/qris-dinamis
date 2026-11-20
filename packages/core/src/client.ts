import type { FeeOption } from './converter.js';

export interface QrisClientConfig {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface CreateMerchantInput {
  name?: string;
  staticQris: string;
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface GenerateQrisInput {
  merchantId: string;
  amount: number;
  useUniqueCode?: boolean;
  fee?: FeeOption;
  ttlSeconds?: number;
  externalId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface MerchantStats {
  merchantId: string;
  totalTransactions: number;
  counts: {
    PENDING: number;
    PAID: number;
    EXPIRED: number;
    FAILED: number;
  };
  totalPaidAmount: number;
  totalUniqueCodeCollected: number;
  conversionRate: number;
}

export interface IngestAdapterInfo {
  name: string;
  displayName: string;
  aliases: string[];
}

export interface TransactionRecord {
  id: string;
  merchantId: string;
  externalId: string | null;
  baseAmount: number;
  uniqueCode: number;
  totalAmount: number;
  dynamicQris: string;
  qrSvg?: string;
  qrDataUrl?: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
}

export class QrisDinamisClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: QrisClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'X-Api-Key': this.apiKey } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    };

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as { error?: string }).error ?? `Request failed with status ${res.status}`;
      throw new Error(msg);
    }
    return data as T;
  }

  createMerchant(input: CreateMerchantInput) {
    return this.request<{ merchant: Record<string, unknown> }>('/v1/merchants', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  decodeQrisImageBase64(imageBase64: string) {
    return this.request<{
      valid: boolean;
      isDynamic: boolean;
      staticQris: string;
      merchant: Record<string, unknown> | null;
    }>('/v1/qris/decode-image', {
      method: 'POST',
      body: JSON.stringify({ imageBase64 }),
    });
  }

  convertQrisImageBase64(input: { imageBase64: string; amount: number; fee?: FeeOption }) {
    return this.request<{
      staticQris: string;
      dynamicQris: string;
      crc: string;
      qrSvg: string;
      qrDataUrl: string;
    }>('/v1/qris/convert-image', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  generateQris(input: GenerateQrisInput) {
    return this.request<{ transaction: TransactionRecord }>('/v1/qris/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  getTransaction(transactionId: string) {
    return this.request<{ transaction: TransactionRecord }>(`/v1/qris/${transactionId}`);
  }

  simulatePayment(transactionId: string) {
    return this.request<{ transaction: TransactionRecord; webhookTriggered: boolean }>(
      '/v1/sandbox/simulate-pay',
      {
        method: 'POST',
        body: JSON.stringify({ transactionId }),
      },
    );
  }

  ingestNotification(input: {
    merchantId: string;
    source: string;
    amount?: number;
    text?: string;
    reference?: string;
  }) {
    return this.request<{ matched: boolean; adapter?: string | null; transaction?: TransactionRecord }>(
      '/v1/ingest/notification',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  listIngestAdapters() {
    return this.request<{ adapters: IngestAdapterInfo[] }>('/v1/ingest/adapters');
  }

  parseIngestPreview(input: { source: string; amount?: number; text?: string; reference?: string }) {
    return this.request<{
      extracted: { amount: number; reference?: string; source: string; adapter?: string } | null;
    }>('/v1/ingest/parse-preview', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  ingestPgWebhook(
    provider: 'doku' | 'snap-bi' | 'midtrans',
    payload: Record<string, unknown>,
    options?: { merchantId?: string; headers?: Record<string, string> },
  ) {
    const query = options?.merchantId ? `?merchantId=${encodeURIComponent(options.merchantId)}` : '';
    return this.request<{ matched: boolean; provider: string; transaction?: TransactionRecord }>(
      `/v1/ingest/pg/${provider}${query}`,
      {
        method: 'POST',
        headers: options?.headers,
        body: JSON.stringify(payload),
      },
    );
  }

  getMerchantStats(merchantId: string) {
    return this.request<MerchantStats>(`/v1/merchants/${encodeURIComponent(merchantId)}/stats`);
  }

  rotateMerchantKeys(
    merchantId: string,
    options?: { rotateApiKey?: boolean; rotateWebhookSecret?: boolean },
  ) {
    return this.request<{
      merchant: Record<string, unknown>;
      rotated: { apiKey: boolean; webhookSecret: boolean };
    }>(`/v1/merchants/${encodeURIComponent(merchantId)}/rotate-keys`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    });
  }

  getTransactionEventsUrl(transactionId: string): string {
    return `${this.baseUrl}/v1/transactions/${encodeURIComponent(transactionId)}/events`;
  }

  validateCpmQr(qrData: string) {
    return this.request<{
      valid: boolean;
      format: string;
      wallet: string | null;
      maskedToken: string | null;
      aid: string | null;
      errors: string[];
    }>('/v1/qris/cpm/validate', {
      method: 'POST',
      body: JSON.stringify({ qrData }),
    });
  }

  payWithCpm(input: {
    merchantId: string;
    amount: number;
    qrData: string;
    externalId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request<{
      approved: boolean;
      wallet: string | null;
      transaction: TransactionRecord;
      webhookTriggered: boolean;
    }>('/v1/qris/cpm/pay', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  cancelTransaction(transactionId: string) {
    return this.request<{ transaction: TransactionRecord; webhookTriggered: boolean }>(
      `/v1/qris/${encodeURIComponent(transactionId)}/cancel`,
      { method: 'POST' },
    );
  }

  refundTransaction(transactionId: string, reason?: string) {
    return this.request<{ transaction: TransactionRecord; webhookTriggered: boolean }>(
      `/v1/qris/${encodeURIComponent(transactionId)}/refund`,
      {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      },
    );
  }
}
