export type CpmQrFormat = 'emvco-cpm-base64' | 'numeric-token' | 'unknown';

export interface CpmValidationResult {
  valid: boolean;
  format: CpmQrFormat;
  wallet: string | null;
  maskedToken: string | null;
  aid: string | null;
  errors: string[];
}

function maskToken(token: string): string {
  const clean = token.trim();
  if (clean.length <= 8) return '****';
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}

/**
 * Parses a minimal BER-TLV buffer (used by EMVCo Customer-Presented Mode QR).
 */
function parseBerTlvStrings(buf: Buffer): { pfi: string | null; aid: string | null; label: string | null; pan: string | null } {
  let pfi: string | null = null;
  let aid: string | null = null;
  let label: string | null = null;
  let pan: string | null = null;

  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    i++;
    if (i >= buf.length) break;

    let len = buf[i]!;
    i++;
    if (len & 0x80) {
      const numBytes = len & 0x7f;
      if (i + numBytes > buf.length) break;
      len = 0;
      for (let b = 0; b < numBytes; b++) {
        len = (len << 8) | buf[i + b]!;
      }
      i += numBytes;
    }

    if (i + len > buf.length) break;
    const val = buf.subarray(i, i + len);
    i += len;

    // Constructed tags (bit 5 set, e.g. 0x61 Application Template) -> descend
    if ((tag! & 0x20) !== 0) {
      const nested = parseBerTlvStrings(val);
      pfi = pfi ?? nested.pfi;
      aid = aid ?? nested.aid;
      label = label ?? nested.label;
      pan = pan ?? nested.pan;
      continue;
    }

    if (tag === 0x85) pfi = val.toString('utf8');
    else if (tag === 0x4f) aid = val.toString('hex').toUpperCase();
    else if (tag === 0x50) label = val.toString('utf8');
    else if (tag === 0x5a) pan = val.toString('hex').replace(/F+$/i, '');
  }

  return { pfi, aid, label, pan };
}

/**
 * Validates a Customer-Presented Mode (CPM) QR payload presented by a payer
 * (supports EMVCo CPM Base64 BER-TLV and 16-32 digit QRIS/e-wallet CPM tokens).
 */
export function validateCpmQr(rawQrData: string): CpmValidationResult {
  const trimmed = rawQrData.trim();
  const errors: string[] = [];

  if (!trimmed) {
    return {
      valid: false,
      format: 'unknown',
      wallet: null,
      maskedToken: null,
      aid: null,
      errors: ['CPM QR payload cannot be empty'],
    };
  }

  // 1. Numeric barcode/QR CPM token (16..32 digits, e.g. DANA / OVO / ShopeePay POS token)
  if (/^\d{16,32}$/.test(trimmed)) {
    const wallet = trimmed.startsWith('9360') ? 'QRIS-CPM' : 'WALLET-CPM';
    return {
      valid: true,
      format: 'numeric-token',
      wallet,
      maskedToken: maskToken(trimmed),
      aid: null,
      errors: [],
    };
  }

  // 2. EMVCo CPM Base64 BER-TLV (typically starts with "hQVDUFY" = 0x85 0x05 "CPV01")
  if (/^[A-Za-z0-9+/=]{16,}$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length >= 8) {
      const parsed = parseBerTlvStrings(buf);
      if (parsed.pfi === 'CPV01' || parsed.aid || parsed.pan) {
        return {
          valid: true,
          format: 'emvco-cpm-base64',
          wallet: parsed.label ?? 'EMVCO-CPM',
          maskedToken: parsed.pan ? maskToken(parsed.pan) : maskToken(trimmed),
          aid: parsed.aid,
          errors: [],
        };
      }
    }
  }

  errors.push('Unsupported or invalid CPM QR format (expected EMVCo CPM Base64 or 16-32 digit CPM token)');
  return {
    valid: false,
    format: 'unknown',
    wallet: null,
    maskedToken: null,
    aid: null,
    errors,
  };
}

/**
 * Builds a valid sample EMVCo CPM Base64 payload for sandbox/testing.
 */
export function buildSampleCpmQr(options?: { wallet?: string; pan?: string }): string {
  const wallet = options?.wallet ?? 'DANA';
  const panHex = options?.pan ?? '936008980001234567';
  const panBytes = Buffer.from(panHex.length % 2 === 0 ? panHex : `${panHex}F`, 'hex');
  const labelBytes = Buffer.from(wallet, 'utf8');
  const aidBytes = Buffer.from('A0000006021010', 'hex');

  const tag4f = Buffer.concat([Buffer.from([0x4f, aidBytes.length]), aidBytes]);
  const tag50 = Buffer.concat([Buffer.from([0x50, labelBytes.length]), labelBytes]);
  const tag5a = Buffer.concat([Buffer.from([0x5a, panBytes.length]), panBytes]);
  const inner = Buffer.concat([tag4f, tag50, tag5a]);
  const tag61 = Buffer.concat([Buffer.from([0x61, inner.length]), inner]);

  const pfi = Buffer.from('CPV01', 'utf8');
  const tag85 = Buffer.concat([Buffer.from([0x85, pfi.length]), pfi]);

  return Buffer.concat([tag85, tag61]).toString('base64');
}
