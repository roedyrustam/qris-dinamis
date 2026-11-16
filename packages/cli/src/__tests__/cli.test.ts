import { computeCrc16, validateQris, verifyWebhookSignature } from '@qris-dinamis/core';
import { describe, expect, it } from 'vitest';
import { runCli } from '../index.js';

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

function createBufferIo(fetchFn?: typeof fetch) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
      fetchFn,
    },
  };
}

describe('@qris-dinamis/cli', () => {
  const sampleStatic = buildSampleStaticQris();

  it('converts static QRIS to dynamic QRIS string and SVG', async () => {
    const strRun = createBufferIo();
    const code1 = await runCli(['convert', sampleStatic, '--amount', '25000', '--fee', 'fixed:1000'], strRun.io);
    expect(code1).toBe(0);
    const dynamic = strRun.out[0]!;
    const validated = validateQris(dynamic);
    expect(validated.valid).toBe(true);
    expect(validated.isDynamic).toBe(true);

    const svgRun = createBufferIo();
    const code2 = await runCli(['convert', sampleStatic, '-a', '15000', '-f', 'svg'], svgRun.io);
    expect(code2).toBe(0);
    expect(svgRun.out[0]).toContain('<svg');
  });

  it('validates and inspects QRIS strings', async () => {
    const inspectRun = createBufferIo();
    const code = await runCli(['inspect', sampleStatic], inspectRun.io);
    expect(code).toBe(0);
    const output = inspectRun.out.join('\n');
    expect(output).toContain('Valid: YES');
    expect(output).toContain('TOKO KOPI KITA');
    expect(output).toContain('[59]');
  });

  it('signs, verifies, and tests webhooks', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'payment.paid' });
    const secret = 'whsec_test_123456';

    const signRun = createBufferIo();
    const signCode = await runCli(['webhook', 'sign', '--secret', secret, '--body', body], signRun.io);
    expect(signCode).toBe(0);
    const sig = signRun.out[0]!;
    expect(sig).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);

    const verifyRun = createBufferIo();
    const verifyCode = await runCli(
      ['webhook', 'verify', '--secret', secret, '--signature', sig, '--body', body],
      verifyRun.io,
    );
    expect(verifyCode).toBe(0);
    expect(verifyRun.out[0]).toBe('VALID');

    let capturedSig = '';
    let capturedBody = '';
    const mockFetch: typeof fetch = async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      capturedSig = headers['X-Qris-Signature'] ?? '';
      capturedBody = String(init?.body ?? '');
      return new Response('{"ok":true}', { status: 200, statusText: 'OK' });
    };

    const testRun = createBufferIo(mockFetch);
    const testCode = await runCli(
      ['webhook', 'test', '--url', 'http://localhost:9999/hook', '--secret', secret, '--amount', '50123'],
      testRun.io,
    );
    expect(testCode).toBe(0);
    expect(testRun.out[0]).toBe('HTTP 200 OK');
    expect(verifyWebhookSignature({ secret, signatureHeader: capturedSig, rawBody: capturedBody })).toBe(true);
  });

  it('sends ingest parse-preview via CLI ingest --preview', async () => {
    let capturedUrl = '';
    const mockFetch: typeof fetch = async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ extracted: { amount: 50123, adapter: 'bca' } }), {
        status: 200,
        statusText: 'OK',
      });
    };

    const ingestRun = createBufferIo(mockFetch);
    const code = await runCli(
      ['ingest', '--url', 'http://localhost:3001', '--source', 'bca', '--text', 'QRIS BCA Rp 50.123', '--preview'],
      ingestRun.io,
    );
    expect(code).toBe(0);
    expect(capturedUrl).toBe('http://localhost:3001/v1/ingest/parse-preview');
    expect(ingestRun.out[0]).toBe('HTTP 200 OK');
  });
});
