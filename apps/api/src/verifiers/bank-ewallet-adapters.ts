import type { ExtractedPayment, IngestPayload, PaymentVerifierAdapter } from './notification-parser.js';

export interface AdapterMetadata {
  name: string;
  displayName: string;
  aliases: readonly string[];
}

interface BankAdapterConfig extends AdapterMetadata {
  textKeywords: readonly RegExp[];
  referencePatterns: readonly RegExp[];
}

const OUTGOING_DENY_PATTERNS: readonly RegExp[] = [
  /\b(?:transfer\s+ke|kirim\s+uang|tarik\s+tunai|pembelian|top\s*up|bayar\s+tagihan|debit\s+keluar)\b/i,
];

const DEFAULT_REFERENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:ref(?:erence)?|no\.?\s*ref|rrn|id\s*transaksi|trx\s*id|order)\s*[:#]?\s*([A-Z0-9_-]{4,32})/i,
];

/**
 * Parses IDR amounts from Indonesian bank & e-wallet push notifications
 * (e.g., "Pembayaran QRIS Rp 50.123 berhasil", "Dana masuk Rp50,123", "IDR 50123.00").
 */
export function parseIndonesianAmount(text: string): number | null {
  const currencyMatch = text.match(/(?:rp\.?|idr)\s*([\d.,]+)/i);
  const candidate = currencyMatch?.[1] ?? text.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,})\b/)?.[1];
  if (!candidate) return null;

  // Strip trailing .00 / ,00 decimals, then thousand separators
  const cleaned = candidate
    .replace(/([.,]00)$/, '')
    .replace(/[.,](?=\d{3}(?:\D|$))/g, '')
    .replace(/[^\d]/g, '');

  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isOutgoingNotification(text: string): boolean {
  return OUTGOING_DENY_PATTERNS.some((pattern) => pattern.test(text));
}

function extractReference(text: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of [...patterns, ...DEFAULT_REFERENCE_PATTERNS]) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

export class ConfigurableNotificationAdapter implements PaymentVerifierAdapter {
  readonly name: string;
  readonly displayName: string;
  readonly aliases: readonly string[];
  private readonly textKeywords: readonly RegExp[];
  private readonly referencePatterns: readonly RegExp[];

  constructor(config: BankAdapterConfig) {
    this.name = config.name;
    this.displayName = config.displayName;
    this.aliases = config.aliases;
    this.textKeywords = config.textKeywords;
    this.referencePatterns = config.referencePatterns;
  }

  supports(source: string): boolean {
    const normalized = source.trim().toLowerCase();
    return this.aliases.includes(normalized);
  }

  matchesText(text: string): boolean {
    return this.textKeywords.some((pattern) => pattern.test(text));
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

    if (!payload.text) {
      return null;
    }

    if (isOutgoingNotification(payload.text)) {
      return null;
    }

    const amount = parseIndonesianAmount(payload.text);
    if (amount === null) {
      return null;
    }

    return {
      amount,
      reference: payload.reference ?? extractReference(payload.text, this.referencePatterns),
      source: payload.source,
      adapter: this.name,
    };
  }
}

const BANK_EWALLET_CONFIGS: readonly BankAdapterConfig[] = [
  {
    name: 'bca',
    displayName: 'BCA / myBCA QRIS',
    aliases: ['bca', 'mybca', 'bca-mobile', 'klikbca', 'qris-bca'],
    textKeywords: [/\b(?:mybca|klikbca|qris\s*bca|bca)\b/i],
    referencePatterns: [/\b(?:ref|rrn)\s*[:#]?\s*([A-Z0-9-]{4,32})/i],
  },
  {
    name: 'bri',
    displayName: 'BRI / BRImo QRIS',
    aliases: ['bri', 'brimo', 'qris-bri', 'brilink'],
    textKeywords: [/\b(?:brimo|brilink|qris\s*bri|bank\s*bri)\b/i],
    referencePatterns: [/\b(?:no\.?\s*ref|ref)\s*[:#]?\s*([A-Z0-9-]{4,32})/i],
  },
  {
    name: 'mandiri',
    displayName: "Bank Mandiri / Livin' Merchant",
    aliases: ['mandiri', 'livin', 'livin-merchant', 'kopra'],
    textKeywords: [/\b(?:livin'?(\s*merchant)?|kopra|mandiri)\b/i],
    referencePatterns: [/\b(?:ref|approval|rrn)\s*[:#]?\s*([A-Z0-9-]{4,32})/i],
  },
  {
    name: 'bni',
    displayName: 'BNI / wondr by BNI',
    aliases: ['bni', 'wondr', 'bni-mobile', 'qris-bni'],
    textKeywords: [/\b(?:wondr|bni\s*mobile|qris\s*bni|bank\s*bni)\b/i],
    referencePatterns: [/\b(?:ref|jurnal)\s*[:#]?\s*([A-Z0-9-]{4,32})/i],
  },
  {
    name: 'gopay',
    displayName: 'GoPay Merchant / GoBiz',
    aliases: ['gopay', 'gobiz', 'gopay-merchant'],
    textKeywords: [/\b(?:gobiz|gopay\s*merchant|gopay)\b/i],
    referencePatterns: [/\border\s*#?([A-Z0-9-]{4,32})/i],
  },
  {
    name: 'ovo',
    displayName: 'OVO Merchant / GrabMerchant',
    aliases: ['ovo', 'ovo-merchant', 'grab-merchant'],
    textKeywords: [/\b(?:ovo\s*merchant|grabmerchant|ovo)\b/i],
    referencePatterns: [/\b(?:ref|trx)\s*[:#]?\s*([A-Z0-9-]{4,32})/i],
  },
  {
    name: 'dana',
    displayName: 'DANA Bisnis',
    aliases: ['dana', 'dana-bisnis', 'dana-merchant'],
    textKeywords: [/\b(?:dana\s*bisnis|dana\s*merchant|dana)\b/i],
    referencePatterns: [/\b(?:order|trx|ref)\s*[:#]?\s*([A-Z0-9-]{4,32})/i],
  },
  {
    name: 'shopeepay',
    displayName: 'ShopeePay / Shopee Partner',
    aliases: ['shopeepay', 'shopee-partner', 'spay'],
    textKeywords: [/\b(?:shopeepay|shopee\s*partner|spay)\b/i],
    referencePatterns: [/\b(?:sn|ref|order)\s*[:#]?\s*([A-Z0-9-]{4,32})/i],
  },
];

export const bankEwalletAdapters: readonly ConfigurableNotificationAdapter[] = BANK_EWALLET_CONFIGS.map(
  (config) => new ConfigurableNotificationAdapter(config),
);
