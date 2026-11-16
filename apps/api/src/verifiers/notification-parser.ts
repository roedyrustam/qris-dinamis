export interface IngestPayload {
  source: string;
  amount?: number;
  text?: string;
  reference?: string;
  raw?: Record<string, unknown>;
}

export interface ExtractedPayment {
  amount: number;
  reference?: string;
  source: string;
}

export interface PaymentVerifierAdapter {
  readonly name: string;
  supports(source: string): boolean;
  extract(payload: IngestPayload): ExtractedPayment | null;
}

/**
 * Parses IDR amounts from Indonesian bank & e-wallet push notifications
 * (e.g., "Pembayaran QRIS Rp 50.123 berhasil", "Dana masuk Rp50,123", "IDR 50123").
 */
export function parseIndonesianAmount(text: string): number | null {
  const currencyMatch = text.match(/(?:rp\.?|idr)\s*([\d.,]+)/i);
  const candidate = currencyMatch?.[1] ?? text.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,})\b/)?.[1];
  if (!candidate) return null;

  // Strip thousand separators (dot or comma followed by 3 digits) and decimal .00 / ,00
  const cleaned = candidate
    .replace(/([.,]00)$/, '')
    .replace(/[.,](?=\d{3}(?:\D|$))/g, '')
    .replace(/[^\d]/g, '');

  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export class IndonesianNotificationAdapter implements PaymentVerifierAdapter {
  readonly name = 'indonesian-notification';

  supports(_source: string): boolean {
    return true;
  }

  extract(payload: IngestPayload): ExtractedPayment | null {
    if (typeof payload.amount === 'number' && Number.isFinite(payload.amount) && payload.amount > 0) {
      return {
        amount: Math.round(payload.amount),
        reference: payload.reference,
        source: payload.source,
      };
    }

    if (payload.text) {
      const amount = parseIndonesianAmount(payload.text);
      if (amount !== null) {
        return {
          amount,
          reference: payload.reference,
          source: payload.source,
        };
      }
    }

    return null;
  }
}

export class VerifierRegistry {
  private readonly adapters: PaymentVerifierAdapter[] = [new IndonesianNotificationAdapter()];

  register(adapter: PaymentVerifierAdapter): void {
    this.adapters.unshift(adapter);
  }

  extract(payload: IngestPayload): ExtractedPayment | null {
    for (const adapter of this.adapters) {
      if (adapter.supports(payload.source)) {
        const result = adapter.extract(payload);
        if (result) return result;
      }
    }
    return null;
  }
}

export const verifierRegistry = new VerifierRegistry();
