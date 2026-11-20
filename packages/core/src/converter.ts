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

export interface AdditionalDataOptions {
  /** Tag 62-01: Bill Number (max 25 chars). */
  billNumber?: string;
  /** Tag 62-05: Reference Label (max 25 chars). */
  referenceLabel?: string;
  /** Tag 62-07: Terminal Label (max 25 chars). */
  terminalLabel?: string;
}

export interface ConvertOptions {
  /** Transaction amount in IDR (must be > 0, max 13 formatted chars per EMVCo Tag 54). */
  amount: number;
  /** Optional convenience fee or tip configuration (EMVCo Tags 55-57). */
  fee?: FeeOption;
  /** Optional Additional Data Field sub-tags merged into Tag 62. */
  additionalData?: AdditionalDataOptions;
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

function formatAmount(value: number, maxLength = 13): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Amount must be a finite number greater than 0');
  }
  const formatted = Number.isInteger(value)
    ? value.toString()
    : value.toFixed(2).replace(/\.?0+$/, '');
  if (formatted === '0' || formatted.length > maxLength) {
    throw new Error(`Formatted amount "${formatted}" exceeds EMVCo limit (max ${maxLength} chars)`);
  }
  return formatted;
}

function formatPercentage(value: number): string {
  if (!Number.isFinite(value) || value < 0.01 || value > 99.99) {
    throw new Error('Percentage fee must be between 0.01 and 99.99 per EMVCo Tag 57');
  }
  const formatted = Number.isInteger(value)
    ? value.toString()
    : value.toFixed(2).replace(/\.?0+$/, '');
  if (formatted.length > 5) {
    throw new Error(`Formatted percentage "${formatted}" exceeds EMVCo Tag 57 limit (max 5 chars)`);
  }
  return formatted;
}

function mergeAdditionalDataTag(existingValue: string | undefined, opts: AdditionalDataOptions): TlvTag {
  let subTags: TlvTag[] = [];
  if (existingValue) {
    try {
      subTags = parseTlv(existingValue);
    } catch {
      subTags = [];
    }
  }

  const upsertSub = (tag: string, rawVal: string | undefined) => {
    if (!rawVal) return;
    const val = rawVal.trim().slice(0, 25);
    if (!val) return;
    const idx = subTags.findIndex((s) => s.tag === tag);
    const next: TlvTag = { tag, length: val.length, value: val };
    if (idx >= 0) subTags[idx] = next;
    else subTags.push(next);
  };

  upsertSub('01', opts.billNumber);
  upsertSub('05', opts.referenceLabel);
  upsertSub('07', opts.terminalLabel);

  const serialized = serializeTlv(subTags);
  return { tag: '62', length: serialized.length, value: serialized };
}

/**
 * Validates an EMVCo QRIS payload (structure, mandatory tags, MAI 26-51, and CRC-16).
 */
export function validateQris(qris: string, options?: { skipCrcCheck?: boolean }): ValidationResult {
  const errors: string[] = [];
  let tags: TlvTag[] = [];
  let merchant: MerchantInfo | null = null;
  const trimmed = qris.trim();

  try {
    tags = parseTlv(trimmed);
    merchant = extractMerchantInfo(tags);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Failed to parse QRIS TLV');
    return { valid: false, errors, isDynamic: false, merchant: null, tags: [] };
  }

  const tagMap = new Map(tags.map((t) => [t.tag, t.value]));
  const hasMerchantAccountInfo = tags.some((t) => {
    const num = Number.parseInt(t.tag, 10);
    return num >= 26 && num <= 51;
  });

  if (tags[0]?.tag !== '00' || tagMap.get('00') !== '01') {
    errors.push('Invalid Payload Format Indicator (Tag 00 must be first and equal to "01")');
  }
  if (!hasMerchantAccountInfo) {
    errors.push('Missing Merchant Account Information (Tags 26-51)');
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
  if (!options?.skipCrcCheck && !verifyCrc16(trimmed)) {
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
 * optional Additional Data Field sub-tags (Tag 62), and recalculated CRC-16/CCITT-FALSE (Tag 63).
 */
export function convertStaticToDynamic(staticQris: string, options: ConvertOptions): ConvertResult {
  const trimmed = staticQris.trim();
  const validation = validateQris(trimmed, { skipCrcCheck: options.skipInputCrcCheck });
  if (!validation.valid) {
    throw new Error(`Invalid input QRIS: ${validation.errors.join('; ')}`);
  }

  const formattedAmount = formatAmount(options.amount, 13);
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

  // Build amount & fee tags in canonical EMVCo order: 54 -> 55 -> 56/57
  const paymentTags: TlvTag[] = [
    { tag: '54', length: formattedAmount.length, value: formattedAmount },
  ];

  if (fee.type === 'prompt') {
    paymentTags.push({ tag: '55', length: 2, value: '01' });
  } else if (fee.type === 'fixed') {
    const feeStr = formatAmount(fee.value, 13);
    paymentTags.push({ tag: '55', length: 2, value: '02' });
    paymentTags.push({ tag: '56', length: feeStr.length, value: feeStr });
  } else if (fee.type === 'percentage') {
    const pctStr = formatPercentage(fee.value);
    paymentTags.push({ tag: '55', length: 2, value: '03' });
    paymentTags.push({ tag: '57', length: pctStr.length, value: pctStr });
  }

  // Insert right after Tag 53 (Currency), falling back to right before Tag 58 (Country Code)
  const tag53Index = baseTags.findIndex((t) => t.tag === '53');
  const tag58Index = baseTags.findIndex((t) => t.tag === '58');
  if (tag53Index >= 0) {
    baseTags.splice(tag53Index + 1, 0, ...paymentTags);
  } else if (tag58Index >= 0) {
    baseTags.splice(tag58Index, 0, ...paymentTags);
  } else {
    baseTags.push(...paymentTags);
  }

  // Merge optional Additional Data Field (Tag 62) while preserving existing sub-tags (e.g. Terminal Label 07)
  if (
    options.additionalData &&
    (options.additionalData.billNumber ||
      options.additionalData.referenceLabel ||
      options.additionalData.terminalLabel)
  ) {
    const existing62Idx = baseTags.findIndex((t) => t.tag === '62');
    const merged62 = mergeAdditionalDataTag(
      existing62Idx >= 0 ? baseTags[existing62Idx]!.value : undefined,
      options.additionalData,
    );
    if (existing62Idx >= 0) {
      baseTags[existing62Idx] = merged62;
    } else {
      baseTags.push(merged62);
    }
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
