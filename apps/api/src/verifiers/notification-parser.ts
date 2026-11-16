import {
  bankEwalletAdapters,
  ConfigurableNotificationAdapter,
  isOutgoingNotification,
  parseIndonesianAmount,
  type AdapterMetadata,
} from './bank-ewallet-adapters.js';

export { parseIndonesianAmount, isOutgoingNotification };

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
  adapter?: string;
}

export interface PaymentVerifierAdapter {
  readonly name: string;
  supports(source: string): boolean;
  extract(payload: IngestPayload): ExtractedPayment | null;
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
        adapter: this.name,
      };
    }

    if (payload.text) {
      if (isOutgoingNotification(payload.text)) {
        return null;
      }
      const amount = parseIndonesianAmount(payload.text);
      if (amount !== null) {
        const refMatch = payload.text.match(/\b(?:ref(?:erence)?|no\.?\s*ref|rrn|order)\s*[:#]?\s*([A-Z0-9_-]{4,32})/i);
        return {
          amount,
          reference: payload.reference ?? refMatch?.[1]?.trim(),
          source: payload.source,
          adapter: this.name,
        };
      }
    }

    return null;
  }
}

export class VerifierRegistry {
  private readonly adapters: PaymentVerifierAdapter[] = [
    ...bankEwalletAdapters,
    new IndonesianNotificationAdapter(),
  ];

  register(adapter: PaymentVerifierAdapter): void {
    this.adapters.unshift(adapter);
  }

  listAdapters(): AdapterMetadata[] {
    return this.adapters.map((adapter) => {
      if (adapter instanceof ConfigurableNotificationAdapter) {
        return {
          name: adapter.name,
          displayName: adapter.displayName,
          aliases: adapter.aliases,
        };
      }
      return {
        name: adapter.name,
        displayName: 'Generic Indonesian Notification Fallback',
        aliases: ['android-notif', 'auto', '*'],
      };
    });
  }

  extract(payload: IngestPayload): ExtractedPayment | null {
    const normalizedSource = payload.source.trim().toLowerCase();

    // 1. Exact source alias match first (excluding generic fallback)
    for (const adapter of this.adapters) {
      if (adapter.name !== 'indonesian-notification' && adapter.supports(normalizedSource)) {
        const result = adapter.extract(payload);
        if (result) return result;
      }
    }

    // 2. Auto-detect bank/e-wallet from notification text for generic sources
    if (payload.text && (normalizedSource === 'android-notif' || normalizedSource === 'auto')) {
      for (const adapter of this.adapters) {
        if (adapter instanceof ConfigurableNotificationAdapter && adapter.matchesText(payload.text)) {
          const result = adapter.extract(payload);
          if (result) return result;
        }
      }
    }

    // 3. Fallback to any remaining supporting adapter (including generic IndonesianNotificationAdapter)
    for (const adapter of this.adapters) {
      if (adapter.supports(normalizedSource)) {
        const result = adapter.extract(payload);
        if (result) return result;
      }
    }

    return null;
  }
}

export const verifierRegistry = new VerifierRegistry();
