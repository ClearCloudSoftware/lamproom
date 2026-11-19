import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { db, dbFile } from '../src/db.ts';
import { tasks } from '../src/schema.ts';

test('db: a new data folder gets its database with every migration, one handle per folder', () => {
  const data = join(mkdtempSync(join(tmpdir(), 'lr-db-')), 'sub');
  const handle = db(data);
  assert.equal(db(data), handle);
  assert.deepEqual(handle.select().from(tasks).all(), []);
  const sqlite = new Database(dbFile(data));
  const applied = sqlite.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get();
  sqlite.close();
  assert.equal(applied, readdirSync(new URL('../drizzle', import.meta.url)).filter((f) => f.endsWith('.sql')).length);
});
