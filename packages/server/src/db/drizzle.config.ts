// drizzle-kit configuration. Run from packages/server:
//   pnpm db:generate   → writes SQL migrations into ./drizzle
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
