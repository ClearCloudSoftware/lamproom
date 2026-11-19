/**
 * Lamproom's database: SQLite at `<data>/lamproom.db`, read and written through Drizzle (`schema.ts`), so moving to
 * another database later is a new driver and new migrations, not new queries. Tasks and backlog imports live here;
 * projects, settings and memory are still JSON files in the data folder.
 *
 * The first open of a data folder's database, in each process, applies the migrations in `packages/cli/drizzle/`
 * it has not had yet (Drizzle's migrator, in one transaction), so the app needs no drizzle-kit at run time.
 */
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema>;

// A path off this file, not `new URL('../drizzle', import.meta.url)`, which Turbopack tries to bundle as an asset.
const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

/** The database file of a data folder. */
export const dbFile = (dataDir: string) => join(dataDir, 'lamproom.db');

// One handle per data folder, kept on globalThis so Next's reloads in development reuse it rather than open more.
const handles: Map<string, Db> = ((globalThis as { lamproomDb?: Map<string, Db> }).lamproomDb ??= new Map());

/** The data folder's database, migrated on its first open in this process. */
export function db(dataDir: string): Db {
  const file = resolve(dbFile(dataDir));
  let handle = handles.get(file);
  if (!handle) {
    mkdirSync(dirname(file), { recursive: true });
    const sqlite = new Database(file);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');
    handle = drizzle(sqlite, { schema });
    migrate(handle, { migrationsFolder: MIGRATIONS });
    handles.set(file, handle);
  }
  return handle;
}
