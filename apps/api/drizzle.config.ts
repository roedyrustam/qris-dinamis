/**
 * Drizzle Kit configuration for SQLite (local/zero-config) or PostgreSQL (production).
 * Usage with drizzle-kit: `npx drizzle-kit push`
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: process.env.DATABASE_DIALECT === 'postgresql' ? 'postgresql' : 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./data/qris.db',
  },
} as const;
