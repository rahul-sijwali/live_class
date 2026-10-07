/**
 * Command-line entry: apply pending migrations and exit. Used by `pnpm db:migrate` and by
 * deploy hooks when `DB_MIGRATE_ON_START` is off.
 */

import { loadConfig } from '../config.js';
import { createDatabase } from './client.js';

const config = loadConfig(process.env);
const handle = await createDatabase(config.DATABASE_URL);
try {
  await handle.migrate();
  console.warn(`Migrations applied (${handle.driver}).`);
} finally {
  await handle.close();
}
