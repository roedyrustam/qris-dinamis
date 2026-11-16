import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  convertStaticToDynamic,
  renderQrSvg,
  renderQrTerminal,
  signWebhookPayload,
  validateQris,
  verifyWebhookSignature,
  type FeeOption,
} from '@qris-dinamis/core';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  fetchFn?: typeof fetch;
}

const DEFAULT_IO: CliIo = {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
  fetchFn: fetch,
};

const HELP_TEXT = `qris-dinamis CLI v1.1.0

Usage:
  qris-dinamis convert <staticQris> --amount <idr> [options]
  qris-dinamis validate <qris> [--json]
  qris-dinamis inspect <qris> [--json]
  qris-dinamis webhook <sign|verify|test> [options]

Convert Options:
  --amount, -a <number>    Transaction amount in IDR (required)
  --fee <spec>             none | prompt | fixed:<val> | percentage:<val> (default: none)
  --format, -f <type>      string | svg | terminal | json (default: string)
  --out, -o <path>         Write output to file
  --skip-crc               Skip input CRC-16 verification

Webhook Subcommands:
  webhook sign    --secret <s> --body <json> [--timestamp <unix>]
  webhook verify  --secret <s> --signature <hdr> --body <json> [--tolerance <sec>]
  webhook test    --url <url> --secret <s> [--event payment.paid|payment.expired] [--amount <idr>] [--tx-id <id>]`;

function parseFeeOption(raw?: string): FeeOption {
  if (!raw || raw === 'none') return { type: 'none' };
  if (raw === 'prompt') return { type: 'prompt' };
  if (raw.startsWith('fixed:')) {
    const value = Number(raw.slice('fixed:'.length));
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid fixed fee value');
    return { type: 'fixed', value };
  }
  if (raw.startsWith('percentage:')) {
    const value = Number(raw.slice('percentage:'.length));
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      throw new Error('Invalid percentage fee value (must be 0 < val <= 100)');
    }
    return { type: 'percentage', value };
  }
  throw new Error(`Unsupported fee format "${raw}". Use none, prompt, fixed:<val>, or percentage:<val>.`);
}

async function handleConvert(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      amount: { type: 'string', short: 'a' },
      fee: { type: 'string' },
      format: { type: 'string', short: 'f', default: 'string' },
      out: { type: 'string', short: 'o' },
      'skip-crc': { type: 'boolean', default: false },
    },
  });

  const staticQris = positionals[0];
  if (!staticQris) {
    io.stderr('Error: missing <staticQris> argument');
    return 1;
  }

  const amount = Number(values.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    io.stderr('Error: --amount must be a positive number');
    return 1;
  }

  const fee = parseFeeOption(values.fee);
  const result = convertStaticToDynamic(staticQris, {
    amount,
    fee,
    skipInputCrcCheck: Boolean(values['skip-crc']),
  });

  let output: string;
  switch (values.format) {
    case 'string':
      output = result.dynamicQris;
      break;
    case 'svg':
      output = await renderQrSvg(result.dynamicQris);
      break;
    case 'terminal':
      output = await renderQrTerminal(result.dynamicQris);
      break;
    case 'json':
      output = JSON.stringify(result, null, 2);
      break;
    default:
      io.stderr(`Error: unsupported --format "${values.format}". Use string, svg, terminal, or json.`);
      return 1;
  }

  if (values.out) {
    await writeFile(values.out, output, 'utf8');
    io.stdout(`Written to ${values.out}`);
  } else {
    io.stdout(output);
  }
  return 0;
}

function handleValidateOrInspect(args: string[], inspectMode: boolean, io: CliIo): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
    },
  });

  const qris = positionals[0];
  if (!qris) {
    io.stderr('Error: missing <qris> argument');
    return 1;
  }

  const res = validateQris(qris);
  if (values.json) {
    io.stdout(JSON.stringify(res, null, 2));
    return res.valid ? 0 : 1;
  }

  io.stdout(`Valid: ${res.valid ? 'YES' : 'NO'} | Type: ${res.isDynamic ? 'DYNAMIC (12)' : 'STATIC (11)'}`);
  if (res.merchant) {
    io.stdout(`Merchant: ${res.merchant.name ?? '-'} (${res.merchant.city ?? '-'})`);
    if (res.merchant.nmid) io.stdout(`NMID: ${res.merchant.nmid}`);
  }
  if (!res.valid) {
    for (const err of res.errors) {
      io.stderr(`- ${err}`);
    }
  }
  if (inspectMode && res.tags.length > 0) {
    io.stdout('TLV Tags:');
    for (const tag of res.tags) {
      io.stdout(`  [${tag.tag}] (len=${tag.length}): ${tag.value}`);
    }
  }

  return res.valid ? 0 : 1;
}

async function handleWebhook(args: string[], io: CliIo): Promise<number> {
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === 'sign') {
    const { values } = parseArgs({
      args: rest,
      options: {
        secret: { type: 'string' },
        body: { type: 'string' },
        timestamp: { type: 'string' },
      },
    });
    if (!values.secret || !values.body) {
      io.stderr('Error: --secret and --body are required for webhook sign');
      return 1;
    }
    const timestamp = values.timestamp ? Number(values.timestamp) : Math.floor(Date.now() / 1000);
    const sig = signWebhookPayload({ secret: values.secret, timestamp, rawBody: values.body });
    io.stdout(sig);
    return 0;
  }

  if (sub === 'verify') {
    const { values } = parseArgs({
      args: rest,
      options: {
        secret: { type: 'string' },
        signature: { type: 'string' },
        body: { type: 'string' },
        tolerance: { type: 'string', default: '300' },
      },
    });
    if (!values.secret || !values.signature || !values.body) {
      io.stderr('Error: --secret, --signature, and --body are required for webhook verify');
      return 1;
    }
    const ok = verifyWebhookSignature({
      secret: values.secret,
      signatureHeader: values.signature,
      rawBody: values.body,
      toleranceSeconds: Number(values.tolerance),
    });
    io.stdout(ok ? 'VALID' : 'INVALID');
    return ok ? 0 : 1;
  }

  if (sub === 'test') {
    const { values } = parseArgs({
      args: rest,
      options: {
        url: { type: 'string' },
        secret: { type: 'string' },
        event: { type: 'string', default: 'payment.paid' },
        amount: { type: 'string', default: '50123' },
        'tx-id': { type: 'string' },
      },
    });
    if (!values.url || !values.secret) {
      io.stderr('Error: --url and --secret are required for webhook test');
      return 1;
    }
    const amount = Number(values.amount);
    const txId = values['tx-id'] ?? `tx_cli_${randomUUID().slice(0, 8)}`;
    const deliveryId = `wh_cli_${randomUUID().slice(0, 8)}`;
    const nowIso = new Date().toISOString();
    const payload = JSON.stringify({
      id: `evt_cli_${randomUUID().slice(0, 8)}`,
      type: values.event,
      createdAt: nowIso,
      data: {
        transactionId: txId,
        merchantId: 'merch_cli_test',
        baseAmount: Math.max(1, amount - 123),
        uniqueCode: 123,
        totalAmount: amount,
        status: values.event === 'payment.expired' ? 'EXPIRED' : 'PAID',
        paidVia: 'cli-test',
        paidAt: values.event === 'payment.paid' ? nowIso : null,
      },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload({ secret: values.secret, timestamp, rawBody: payload });
    const doFetch = io.fetchFn ?? fetch;

    const response = await doFetch(values.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'QrisDinamis-CLI/1.1',
        'X-Qris-Event': values.event ?? 'payment.paid',
        'X-Qris-Delivery-Id': deliveryId,
        'X-Qris-Signature': signature,
      },
      body: payload,
    });
    const responseText = await response.text();
    io.stdout(`HTTP ${response.status} ${response.statusText}`);
    if (responseText) io.stdout(responseText);
    return response.ok ? 0 : 1;
  }

  io.stderr(`Error: unknown webhook subcommand "${sub ?? ''}". Use sign, verify, or test.`);
  return 1;
}

export async function runCli(argv: string[], io: CliIo = DEFAULT_IO): Promise<number> {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    io.stdout(HELP_TEXT);
    return 0;
  }
  if (command === '--version' || command === '-v') {
    io.stdout('1.1.0');
    return 0;
  }

  try {
    switch (command) {
      case 'convert':
        return await handleConvert(argv.slice(1), io);
      case 'validate':
        return handleValidateOrInspect(argv.slice(1), false, io);
      case 'inspect':
        return handleValidateOrInspect(argv.slice(1), true, io);
      case 'webhook':
        return await handleWebhook(argv.slice(1), io);
      default:
        io.stderr(`Error: unknown command "${command}". Run with --help for usage.`);
        return 1;
    }
  } catch (err) {
    io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
