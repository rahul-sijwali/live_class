/**
 * Database connection factory: real Postgres or the embedded PGlite, chosen by URL.
 *
 * Owns: driver selection, migrations and shutdown. `pglite://memory` runs fully in memory
 * (tests), `pglite://<dir>` persists to a folder (development without any install), and
 * `postgres://…` connects to a server (Supabase, Neon, any Postgres). Services only see
 * the `Db` type, never the driver (CLAUDE.md §4 adapters).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { type PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';

import * as schema from './schema.js';

/** The database handle every service depends on. Works for both drivers and transactions. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A live connection with lifecycle controls. */
export interface DatabaseHandle {
  readonly db: Db;
  readonly driver: 'pglite' | 'postgres';
  /**
   * Applies pending migrations from the `drizzle/` folder.
   *
   * @returns {Promise<void>} Resolves when the schema is current.
   */
  migrate(): Promise<void>;
  /**
   * Checks connectivity with a trivial query.
   *
   * @returns {Promise<boolean>} True if the database answered.
   */
  ping(): Promise<boolean>;
  /**
   * Closes the connection pool or embedded instance.
   *
   * @returns {Promise<void>} Resolves when closed.
   */
  close(): Promise<void>;
}

/** Folder with generated SQL migrations (sibling of `src` and `dist`). */
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

/**
 * Opens a database connection for the given URL.
 *
 * @param {string} databaseUrl - `pglite://memory`, `pglite://<dir>` or a Postgres URL.
 * @returns {Promise<DatabaseHandle>} The connected handle (not yet migrated).
 * @throws {Error} If the URL scheme is not recognised.
 */
export async function createDatabase(databaseUrl: string): Promise<DatabaseHandle> {
  if (databaseUrl.startsWith('pglite://')) {
    const target = databaseUrl.slice('pglite://'.length);
    const client =
      target === 'memory' || target === '' ? new PGlite() : new PGlite(path.resolve(target));
    await client.waitReady;
    const db = drizzlePglite(client, { schema });
    return {
      db: db as unknown as Db,
      driver: 'pglite',
      migrate: () => migratePglite(db, { migrationsFolder }),
      ping: async () => {
        await db.execute(sql`select 1`);
        return true;
      },
      close: () => client.close(),
    };
  }
  if (/^postgres(ql)?:\/\//.test(databaseUrl)) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    const db = drizzlePg(pool, { schema });
    return {
      db: db as unknown as Db,
      driver: 'postgres',
      migrate: () => migratePg(db, { migrationsFolder }),
      ping: async () => {
        await db.execute(sql`select 1`);
        return true;
      },
      close: () => pool.end(),
    };
  }
  throw new Error(`Unsupported DATABASE_URL scheme in "${databaseUrl.split(':')[0] ?? ''}"`);
}
