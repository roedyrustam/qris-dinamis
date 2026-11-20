export interface TlvTag {
  tag: string;
  length: number;
  value: string;
}

export interface MerchantInfo {
  name: string | null;
  city: string | null;
  countryCode: string | null;
  currencyCode: string | null;
  postalCode: string | null;
  pointOfInitiation: '11' | '12' | string | null;
  nmid: string | null;
  acquirer: string | null;
}

export class QrisParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrisParseError';
  }
}

/**
 * Parses an EMVCo TLV-encoded QRIS string into an ordered list of tags.
 */
export function parseTlv(raw: string): TlvTag[] {
  const input = raw.trim();
  if (!input) {
    throw new QrisParseError('QRIS string cannot be empty');
  }

  const tags: TlvTag[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    if (cursor + 4 > input.length) {
      throw new QrisParseError(`Truncated TLV header at index ${cursor}`);
    }

    const tag = input.slice(cursor, cursor + 2);
    const lengthStr = input.slice(cursor + 2, cursor + 4);
    const length = Number.parseInt(lengthStr, 10);

    if (!/^\d{2}$/.test(lengthStr) || Number.isNaN(length) || length < 0) {
      throw new QrisParseError(`Invalid TLV length "${lengthStr}" for tag ${tag} at index ${cursor}`);
    }

    const valueStart = cursor + 4;
    const valueEnd = valueStart + length;
    if (valueEnd > input.length) {
      throw new QrisParseError(
        `TLV value for tag ${tag} exceeds payload length (expected ${length} chars at index ${valueStart})`,
      );
    }

    const value = input.slice(valueStart, valueEnd);
    tags.push({ tag, length, value });
    cursor = valueEnd;
  }

  return tags;
}

/**
 * Serializes an ordered list of TLV tags back into an EMVCo QRIS string.
 */
export function serializeTlv(tags: TlvTag[]): string {
  return tags
    .map(({ tag, value }) => {
      const len = value.length.toString().padStart(2, '0');
      return `${tag}${len}${value}`;
    })
    .join('');
}

/**
 * Extracts structured merchant metadata from parsed EMVCo QRIS tags.
 */
export function extractMerchantInfo(tags: TlvTag[]): MerchantInfo {
  const byTag = new Map(tags.map((t) => [t.tag, t.value]));

  let nmid: string | null = null;
  let acquirer: string | null = null;

  // Merchant Account Information resides in tags 26..51 (Tag 51 is National QRIS NMID)
  for (const t of tags) {
    const tagNum = Number.parseInt(t.tag, 10);
    if (tagNum >= 26 && tagNum <= 51) {
      try {
        const subTags = parseTlv(t.value);
        const subMap = new Map(subTags.map((st) => [st.tag, st.value]));
        if (!acquirer && tagNum < 51 && subMap.has('00')) {
          acquirer = subMap.get('00') ?? null;
        }
        const candidateNmid = subMap.get('02');
        if (candidateNmid) {
          // Prefer official Tag 51 NMID or ID-prefixed National Merchant ID
          if (tagNum === 51 || (!nmid && candidateNmid) || (candidateNmid.startsWith('ID') && !nmid?.startsWith('ID'))) {
            nmid = candidateNmid;
          }
        }
      } catch {
        // Ignore non-TLV proprietary sub-tags
      }
    }
  }

  if (!acquirer) {
    const tag51 = byTag.get('51');
    if (tag51) {
      try {
        acquirer = new Map(parseTlv(tag51).map((st) => [st.tag, st.value])).get('00') ?? null;
      } catch {
        // Ignore
      }
    }
  }

  return {
    name: byTag.get('59') ?? null,
    city: byTag.get('60') ?? null,
    countryCode: byTag.get('58') ?? null,
    currencyCode: byTag.get('53') ?? null,
    postalCode: byTag.get('61') ?? null,
    pointOfInitiation: byTag.get('01') ?? null,
    nmid,
    acquirer,
  };
}
