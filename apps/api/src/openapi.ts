export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'QRIS Dinamis API & Webhook Engine',
    version: '1.0.0',
    description:
      'REST API untuk mengubah QRIS statis menjadi dinamis, mengelola transaksi dengan kode unik anti-kolisi, menerima notifikasi pembayaran (pluggable verifier), dan mengirim webhook HMAC-SHA256.',
  },
  servers: [{ url: 'http://localhost:3001', description: 'Local Development Server' }],
  paths: {
    '/health': {
      get: {
        summary: 'Health Check',
        responses: { '200': { description: 'Server is healthy' } },
      },
    },
    '/v1/merchants': {
      get: {
        summary: 'List Merchants',
        responses: { '200': { description: 'Array of registered merchants' } },
      },
      post: {
        summary: 'Register Static QRIS Merchant',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['staticQris'],
                properties: {
                  name: { type: 'string' },
                  staticQris: { type: 'string' },
                  webhookUrl: { type: 'string', format: 'uri' },
                  webhookSecret: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Merchant created' } },
      },
    },
    '/v1/merchants/upload': {
      post: {
        summary: 'Register Merchant by Uploading Static QRIS Image (PNG/JPG)',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  name: { type: 'string' },
                  webhookUrl: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Merchant created from QRIS image' } },
      },
    },
    '/v1/qris/decode-image': {
      post: {
        summary: 'Decode Static QRIS String from Uploaded Image (PNG/JPG or Base64)',
        responses: { '200': { description: 'Decoded static QRIS string & merchant metadata' } },
      },
    },
    '/v1/qris/convert-image': {
      post: {
        summary: 'Upload Static QRIS Image & Convert Directly to Dynamic QRIS',
        responses: { '200': { description: 'Converted dynamic QRIS string & QR SVG/PNG' } },
      },
    },
    '/v1/qris/convert': {
      post: {
        summary: 'Stateless Static-to-Dynamic QRIS Conversion',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['staticQris', 'amount'],
                properties: {
                  staticQris: { type: 'string' },
                  amount: { type: 'number', minimum: 1 },
                  fee: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: ['none', 'prompt', 'fixed', 'percentage'] },
                      value: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Converted dynamic QRIS string & QR SVG' } },
      },
    },
    '/v1/qris/generate': {
      post: {
        summary: 'Create Dynamic QRIS Transaction',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['merchantId', 'amount'],
                properties: {
                  merchantId: { type: 'string' },
                  amount: { type: 'integer', minimum: 1 },
                  useUniqueCode: { type: 'boolean', default: true },
                  ttlSeconds: { type: 'integer', default: 900 },
                  externalId: { type: 'string' },
                  idempotencyKey: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Transaction created with dynamic QRIS' } },
      },
    },
    '/v1/qris/{id}': {
      get: {
        summary: 'Get Transaction Status & QR',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Transaction details' } },
      },
    },
    '/v1/transactions/{id}/events': {
      get: {
        summary: 'Subscribe to Real-Time Transaction Status Updates (SSE)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'text/event-stream emitting status events (PENDING, PAID, EXPIRED)' } },
      },
    },
    '/v1/ingest/adapters': {
      get: {
        summary: 'List Registered Bank & E-Wallet Notification Adapters',
        responses: { '200': { description: 'Array of supported verifier adapters and aliases' } },
      },
    },
    '/v1/ingest/parse-preview': {
      post: {
        summary: 'Dry-run Notification Parser (No DB Mutation)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['source'],
                properties: {
                  source: { type: 'string', example: 'bca' },
                  amount: { type: 'number' },
                  text: { type: 'string', example: 'QRIS BCA Rp 50.123 BERHASIL Ref: ABC123' },
                  reference: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Extracted amount, adapter, and reference' } },
      },
    },
    '/v1/ingest/notification': {
      post: {
        summary: 'Ingest Payment Notification (Android Listener / Mutasi Parser)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['merchantId', 'source'],
                properties: {
                  merchantId: { type: 'string' },
                  source: { type: 'string', example: 'android-notif' },
                  amount: { type: 'number' },
                  text: { type: 'string', example: 'Pembayaran QRIS Rp 50.123 berhasil' },
                  reference: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Match result' } },
      },
    },
    '/v1/sandbox/simulate-pay': {
      post: {
        summary: 'Simulate Payment Success (Sandbox)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['transactionId'],
                properties: { transactionId: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Transaction marked PAID & webhook dispatched' } },
      },
    },
    '/v1/webhooks/logs': {
      get: {
        summary: 'List Webhook Delivery Logs',
        responses: { '200': { description: 'Webhook delivery history' } },
      },
    },
  },
};
