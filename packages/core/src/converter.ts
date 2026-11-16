import { computeCrc16, verifyCrc16 } from './crc16.js';
import {
  extractMerchantInfo,
  parseTlv,
  serializeTlv,
  type MerchantInfo,
  type TlvTag,
} from './tlv.js';

export type FeeOption =
  | { type: 'none' }
  | { type: 'prompt' }
  | { type: 'fixed'; value: number }
  | { type: 'percentage'; value: number };

export interface ConvertOptions {
  /** Transaction amount in IDR (must be > 0). */
  amount: number;
  /** Optional convenience fee or tip configuration (EMVCo Tags 55-57). */
  fee?: FeeOption;
  /** Skip CRC verification of the input static QRIS (not recommended for production). */
  skipInputCrcCheck?: boolean;
}

export interface ConvertResult {
  dynamicQris: string;
  crc: string;
  amount: number;
  fee: FeeOption;
  merchant: MerchantInfo;
  tags: TlvTag[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  isDynamic: boolean;
  merchant: MerchantInfo | null;
  tags: TlvTag[];
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Amount must be a finite number greater than 0');
  }
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Validates an EMVCo QRIS payload (structure, mandatory tags, and CRC-16).
 */
export function validateQris(qris: string, options?: { skipCrcCheck?: boolean }): ValidationResult {
  const errors: string[] = [];
  let tags: TlvTag[] = [];
  let merchant: MerchantInfo | null = null;

  try {
    tags = parseTlv(qris.trim());
    merchant = extractMerchantInfo(tags);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Failed to parse QRIS TLV');
    return { valid: false, errors, isDynamic: false, merchant: null, tags: [] };
  }

  const tagMap = new Map(tags.map((t) => [t.tag, t.value]));

  if (tagMap.get('00') !== '01') {
    errors.push('Invalid Payload Format Indicator (Tag 00 must be "01")');
  }
  if (tagMap.get('53') !== '360') {
    errors.push('Invalid Transaction Currency (Tag 53 must be "360" for IDR)');
  }
  if (tagMap.get('58') !== 'ID') {
    errors.push('Invalid Country Code (Tag 58 must be "ID")');
  }
  if (!tagMap.has('59')) {
    errors.push('Missing Merchant Name (Tag 59)');
  }
  if (!options?.skipCrcCheck && !verifyCrc16(qris.trim())) {
    errors.push('Invalid CRC-16 checksum (Tag 63)');
  }

  return {
    valid: errors.length === 0,
    errors,
    isDynamic: tagMap.get('01') === '12',
    merchant,
    tags,
  };
}

/**
 * Converts a Static QRIS string (Tag 01 = "11") into a Dynamic QRIS string (Tag 01 = "12")
 * with the specified transaction amount (Tag 54), optional fee/tip (Tags 55-57),
 * and recalculated CRC-16/CCITT-FALSE checksum (Tag 63).
 */
export function convertStaticToDynamic(staticQris: string, options: ConvertOptions): ConvertResult {
  const trimmed = staticQris.trim();
  const validation = validateQris(trimmed, { skipCrcCheck: options.skipInputCrcCheck });
  if (!validation.valid) {
    throw new Error(`Invalid input QRIS: ${validation.errors.join('; ')}`);
  }

  const formattedAmount = formatAmount(options.amount);
  const fee: FeeOption = options.fee ?? { type: 'none' };

  // Strip mutable tags (01, 54, 55, 56, 57, 63) and rebuild cleanly in canonical EMVCo order
  const stripTags = new Set(['01', '54', '55', '56', '57', '63']);
  const baseTags = validation.tags.filter((t) => !stripTags.has(t.tag));

  // Ensure Tag 01 = "12" (Dynamic) sits right after Tag 00
  const tag00Index = baseTags.findIndex((t) => t.tag === '00');
  const dynamicIndicator: TlvTag = { tag: '01', length: 2, value: '12' };
  if (tag00Index >= 0) {
    baseTags.splice(tag00Index + 1, 0, dynamicIndicator);
  } else {
    baseTags.unshift(dynamicIndicator);
  }

  // Build amount & fee tags to insert right before Tag 58 (Country Code)
  const paymentTags: TlvTag[] = [
    { tag: '54', length: formattedAmount.length, value: formattedAmount },
  ];

  if (fee.type === 'prompt') {
    paymentTags.push({ tag: '55', length: 2, value: '01' });
  } else if (fee.type === 'fixed') {
    const feeStr = formatAmount(fee.value);
    paymentTags.push({ tag: '55', length: 2, value: '02' });
    paymentTags.push({ tag: '56', length: feeStr.length, value: feeStr });
  } else if (fee.type === 'percentage') {
    if (!Number.isFinite(fee.value) || fee.value <= 0 || fee.value > 100) {
      throw new Error('Percentage fee must be > 0 and <= 100');
    }
    const pctStr = formatAmount(fee.value);
    paymentTags.push({ tag: '55', length: 2, value: '03' });
    paymentTags.push({ tag: '57', length: pctStr.length, value: pctStr });
  }

  const tag58Index = baseTags.findIndex((t) => t.tag === '58');
  if (tag58Index >= 0) {
    baseTags.splice(tag58Index, 0, ...paymentTags);
  } else {
    baseTags.push(...paymentTags);
  }

  const bodyWithCrcPrefix = `${serializeTlv(baseTags)}6304`;
  const crc = computeCrc16(bodyWithCrcPrefix);
  const dynamicQris = `${bodyWithCrcPrefix}${crc}`;
  const finalTags = [...baseTags, { tag: '63', length: 4, value: crc }];

  return {
    dynamicQris,
    crc,
    amount: options.amount,
    fee,
    merchant: extractMerchantInfo(finalTags),
    tags: finalTags,
  };
}
