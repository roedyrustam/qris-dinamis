import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { transactionEvents } from './services/events.js';
import { expireStaleTransactions } from './services/transaction.js';
import { processDueWebhookRetries } from './services/webhook.js';

const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  transactionEvents.initFromEnv();
  const { db, client } = await createDb();
  const app = createApp(db);

  // Background worker: expire stale transactions & process webhook retries every 15s
  const workerInterval = setInterval(async () => {
    try {
      await expireStaleTransactions(db);
      await processDueWebhookRetries(db);
    } catch (err) {
      console.error('[worker] error:', err);
    }
  }, 15_000);
  workerInterval.unref();

  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`QRIS Dinamis API listening on http://localhost:${info.port}`);
    console.log(`OpenAPI Docs available at http://localhost:${info.port}/docs`);
  });

  let isShuttingDown = false;
  const shutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    clearInterval(workerInterval);

    server.close(async (err) => {
      if (err) {
        console.error('Error closing HTTP server:', err);
      }
      try {
        await transactionEvents.close();
        client.close();
      } catch (dbErr) {
        console.error('Error closing DB client:', dbErr);
      }
      process.exit(err ? 1 : 0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal API startup error:', err);
  process.exit(1);
});
