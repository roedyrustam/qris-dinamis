import { describe, expect, it } from 'vitest';
import {
  computeCrc16,
  convertStaticToDynamic,
  extractMerchantInfo,
  parseTlv,
  renderQrDataUrl,
  renderQrSvg,
  signWebhookPayload,
  validateQris,
  verifyCrc16,
  verifyWebhookSignature,
} from '../index.js';

function buildSampleStaticQris(): string {
  const body =
    '000201' +
    '010211' +
    '26670015ID.CO.GOPAY.WWW01189360089800012345670215ID10200300405060303UMI' +
    '52045499' +
    '5303360' +
    '5802ID' +
    '5914TOKO KOPI KITA' +
    '6007JAKARTA' +
    '610512345' +
    '6304';
  return `${body}${computeCrc16(body)}`;
}

describe('@qris-dinamis/core', () => {
  const sampleStatic = buildSampleStaticQris();

  it('validates CRC-16 and static QRIS structure', () => {
    expect(verifyCrc16(sampleStatic)).toBe(true);
    const validation = validateQris(sampleStatic);
    expect(validation.valid).toBe(true);
    expect(validation.isDynamic).toBe(false);
    expect(validation.merchant?.name).toBe('TOKO KOPI KITA');
    expect(validation.merchant?.city).toBe('JAKARTA');
    expect(validation.merchant?.nmid).toBe('ID1020030040506');
    expect(validation.merchant?.acquirer).toBe('ID.CO.GOPAY.WWW');
  });

  it('converts static QRIS to dynamic QRIS with amount and valid CRC', () => {
    const result = convertStaticToDynamic(sampleStatic, { amount: 50000 });
    expect(verifyCrc16(result.dynamicQris)).toBe(true);

    const tags = parseTlv(result.dynamicQris);
    const map = new Map(tags.map((t) => [t.tag, t.value]));
    expect(map.get('01')).toBe('12');
    expect(map.get('54')).toBe('50000');
    expect(map.get('59')).toBe('TOKO KOPI KITA');

    const validation = validateQris(result.dynamicQris);
    expect(validation.valid).toBe(true);
    expect(validation.isDynamic).toBe(true);
  });

  it('supports fixed, percentage, and prompt fee options', () => {
    const fixedRes = convertStaticToDynamic(sampleStatic, {
      amount: 25000,
      fee: { type: 'fixed', value: 1500 },
    });
    const fixedMap = new Map(fixedRes.tags.map((t) => [t.tag, t.value]));
    expect(fixedMap.get('55')).toBe('02');
    expect(fixedMap.get('56')).toBe('1500');
    expect(verifyCrc16(fixedRes.dynamicQris)).toBe(true);

    const pctRes = convertStaticToDynamic(sampleStatic, {
      amount: 100000,
      fee: { type: 'percentage', value: 2.5 },
    });
    const pctMap = new Map(pctRes.tags.map((t) => [t.tag, t.value]));
    expect(pctMap.get('55')).toBe('03');
    expect(pctMap.get('57')).toBe('2.5');
    expect(verifyCrc16(pctRes.dynamicQris)).toBe(true);

    const promptRes = convertStaticToDynamic(sampleStatic, {
      amount: 15000,
      fee: { type: 'prompt' },
    });
    const promptMap = new Map(promptRes.tags.map((t) => [t.tag, t.value]));
    expect(promptMap.get('55')).toBe('01');
    expect(verifyCrc16(promptRes.dynamicQris)).toBe(true);
  });

  it('rejects tampered CRC or invalid amount', () => {
    const tampered = `${sampleStatic.slice(0, -1)}Z`;
    expect(verifyCrc16(tampered)).toBe(false);
    expect(() => convertStaticToDynamic(tampered, { amount: 10000 })).toThrow(/CRC-16/);
    expect(() => convertStaticToDynamic(sampleStatic, { amount: 0 })).toThrow(/greater than 0/);
  });

  it('renders SVG and PNG DataURL QR codes', async () => {
    const { dynamicQris } = convertStaticToDynamic(sampleStatic, { amount: 12500 });
    const svg = await renderQrSvg(dynamicQris);
    expect(svg).toContain('<svg');
    const dataUrl = await renderQrDataUrl(dynamicQris);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('signs and verifies HMAC-SHA256 webhook signatures', () => {
    const secret = 'whsec_test_123456';
    const timestamp = 1760000000;
    const rawBody = JSON.stringify({ event: 'payment.paid', amount: 50123 });
    const header = signWebhookPayload({ secret, timestamp, rawBody });

    expect(
      verifyWebhookSignature({
        secret,
        signatureHeader: header,
        rawBody,
        nowSeconds: timestamp + 30,
      }),
    ).toBe(true);

    expect(
      verifyWebhookSignature({
        secret,
        signatureHeader: header,
        rawBody: '{"event":"tampered"}',
        nowSeconds: timestamp + 30,
      }),
    ).toBe(false);

    expect(
      verifyWebhookSignature({
        secret,
        signatureHeader: header,
        rawBody,
        toleranceSeconds: 60,
        nowSeconds: timestamp + 120,
      }),
    ).toBe(false);
  });

  it('extracts merchant info cleanly', () => {
    const tags = parseTlv(sampleStatic);
    const info = extractMerchantInfo(tags);
    expect(info.pointOfInitiation).toBe('11');
    expect(info.currencyCode).toBe('360');
    expect(info.countryCode).toBe('ID');
  });

  it('QrisDinamisClient calls stats, rotate-keys, adapters, parse-preview, pg ingest, and SSE URL', async () => {
    const { QrisDinamisClient } = await import('../index.js');
    const calls: string[] = [];
    const client = new QrisDinamisClient({
      baseUrl: 'https://api.example.com/',
      apiKey: 'qris_live_test',
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await client.getMerchantStats('m_1');
    await client.rotateMerchantKeys('m_1', { rotateApiKey: true });
    await client.listIngestAdapters();
    await client.parseIngestPreview({ source: 'bca', text: 'Rp 50.000' });
    await client.ingestPgWebhook('doku', { order: { amount: 50000 } }, { merchantId: 'm_1' });

    expect(calls).toEqual([
      'https://api.example.com/v1/merchants/m_1/stats',
      'https://api.example.com/v1/merchants/m_1/rotate-keys',
      'https://api.example.com/v1/ingest/adapters',
      'https://api.example.com/v1/ingest/parse-preview',
      'https://api.example.com/v1/ingest/pg/doku?merchantId=m_1',
    ]);
    expect(client.getTransactionEventsUrl('tx_123')).toBe(
      'https://api.example.com/v1/transactions/tx_123/events',
    );
  });

  it('validates EMVCo CPM Base64 and numeric QRIS CPM tokens', async () => {
    const { buildSampleCpmQr, validateCpmQr } = await import('../index.js');

    const emvCpm = buildSampleCpmQr({ wallet: 'DANA', pan: '936008980001234567' });
    const res1 = validateCpmQr(emvCpm);
    expect(res1.valid).toBe(true);
    expect(res1.format).toBe('emvco-cpm-base64');
    expect(res1.wallet).toBe('DANA');
    expect(res1.maskedToken).toBe('9360****4567');

    const res2 = validateCpmQr('93600898000123456789');
    expect(res2.valid).toBe(true);
    expect(res2.format).toBe('numeric-token');
    expect(res2.wallet).toBe('QRIS-CPM');

    const res3 = validateCpmQr('invalid-short');
    expect(res3.valid).toBe(false);
    expect(res3.errors.length).toBeGreaterThan(0);
  });

  it('enforces EMVCo Tag 54/57 limits, preserves Tag 62 sub-tags, handles whitespace CRC, and prefers Tag 51 NMID', () => {
    // 1. Trailing newline CRC verification
    expect(verifyCrc16(`${sampleStatic}\n`)).toBe(true);

    // 2. Tag 57 percentage bounds (0.01..99.99)
    expect(() =>
      convertStaticToDynamic(sampleStatic, { amount: 10000, fee: { type: 'percentage', value: 100 } }),
    ).toThrow(/0\.01 and 99\.99/);
    expect(() =>
      convertStaticToDynamic(sampleStatic, { amount: 10000, fee: { type: 'percentage', value: 0.001 } }),
    ).toThrow(/0\.01 and 99\.99/);

    // 3. Tag 54 max 13 chars
    expect(() =>
      convertStaticToDynamic(sampleStatic, { amount: 12345678901234 }),
    ).toThrow(/max 13 chars/);

    // 4. Tag 62 merge preserves existing sub-tag 07 while inserting 01 & 05, and places Tag 54 right after Tag 53
    const bodyWithTag51And62 =
      '000201' +
      '010211' +
      '26500015ID.CO.GOPAY.WWW01189360089800012345670205G9999' +
      '51440014ID.CO.QRIS.WWW0215ID20260000123450303UMI' +
      '52045499' +
      '5303360' +
      '5802ID' +
      '5914TOKO KOPI KITA' +
      '6007JAKARTA' +
      '62070703A01' +
      '6304';
    const qrisWith62 = `${bodyWithTag51And62}${computeCrc16(bodyWithTag51And62)}`;

    const converted = convertStaticToDynamic(qrisWith62, {
      amount: 50000,
      additionalData: { billNumber: 'INV-88', referenceLabel: 'REF-01' },
    });

    expect(verifyCrc16(converted.dynamicQris)).toBe(true);
    expect(converted.merchant.nmid).toBe('ID2026000012345');
    expect(converted.merchant.acquirer).toBe('ID.CO.GOPAY.WWW');

    const tagOrder = converted.tags.map((t) => t.tag);
    expect(tagOrder.indexOf('54')).toBe(tagOrder.indexOf('53') + 1);

    const tag62 = converted.tags.find((t) => t.tag === '62');
    expect(tag62).toBeDefined();
    const sub62 = new Map(parseTlv(tag62!.value).map((s) => [s.tag, s.value]));
    expect(sub62.get('07')).toBe('A01');
    expect(sub62.get('01')).toBe('INV-88');
    expect(sub62.get('05')).toBe('REF-01');
  });
});
