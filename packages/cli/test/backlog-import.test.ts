import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTasks, startBacklogImport, type RunLook } from '../src/backlog-import.ts';
import type { Project } from '../src/projects.ts';
import { getImport, listTasks, openDb } from '../src/storage.ts';

const BACKLOG = '## Backlog\n\n- **Filter list by status** — add a dropdown\n- **Export CSV**: from the table\n';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'lr-backlog-'));
  const repo = join(dir, 'repo');
  await mkdir(repo);
  const project = { id: 'p1', repoPath: repo } as Project;
  return { db: openDb(join(dir, 'data', 'lamproom.db')), dataDir: join(dir, 'data'), runsDir: join(dir, 'runs'), project, dir };
}

const started = async () => ({ ok: true as const, name: 'run-1' });
const lookDone = (output: string): RunLook => () => ({ status: 'done', output });

test('the importer agent’s tasks are saved, with no note', async () => {
  const { db, dataDir, runsDir, project } = await setup();
  const out = JSON.stringify([{ title: 'Log out everywhere', body: 'From the account page.', acceptance_criteria: ['every session ends'] }]);
  const r = await startBacklogImport(db, dataDir, runsDir, project, { content: BACKLOG }, { start: started, look: lookDone(out), pollMs: 1 });
  assert.ok(r.ok);
  await r.finished;
  const row = getImport(db, r.importId)!;
  assert.equal(row.state, 'done');
  assert.equal(row.created, 1);
  assert.equal(row.note, null);
  const [t] = listTasks(db, 'p1', {});
  assert.equal(t?.importKey, 'log-out-everywhere');
  assert.deepEqual(t?.acceptance, ['every session ends']);
});

test('the parser reads the backlog when the agent cannot start, and the note says why', async () => {
  const { db, dataDir, runsDir, project } = await setup();
  const r = await startBacklogImport(db, dataDir, runsDir, project, { content: BACKLOG }, { start: async () => ({ ok: false, error: 'the folder is locked' }), pollMs: 1 });
  assert.ok(r.ok);
  await r.finished;
  const row = getImport(db, r.importId)!;
  assert.equal(row.state, 'done');
  assert.equal(row.created, 2);
  assert.equal(row.note, 'read by the parser: the importer agent did not start: the folder is locked');
  assert.deepEqual(listTasks(db, 'p1', {}).map((t) => t.importKey).sort(), ['export-csv', 'filter-list-by-status']);
});

test('unreadable agent output falls back to the parser; a re-import creates nothing new', async () => {
  const { db, dataDir, runsDir, project } = await setup();
  for (const expected of [{ created: 2, updated: 0 }, { created: 0, updated: 2 }]) {
    const r = await startBacklogImport(db, dataDir, runsDir, project, { content: BACKLOG }, { start: started, look: lookDone('no json here'), pollMs: 1 });
    assert.ok(r.ok);
    await r.finished;
    const row = getImport(db, r.importId)!;
    assert.deepEqual({ created: row.created, updated: row.updated }, expected);
    assert.match(row.note ?? '', /no task list Lamproom can read/);
  }
});

test('a failed run with a backlog the parser cannot read either fails the import', async () => {
  const { db, dataDir, runsDir, project } = await setup();
  const r = await startBacklogImport(db, dataDir, runsDir, project, { content: 'just prose' }, { start: started, look: () => ({ status: 'failed' }), pollMs: 1 });
  assert.ok(r.ok);
  await r.finished;
  const row = getImport(db, r.importId)!;
  assert.equal(row.state, 'failed');
  assert.match(row.error ?? '', /importer agent failed, and the parser found no task/);
});

test('a path outside the repo, both inputs, or an empty backlog are refused before anything runs', async () => {
  const { db, dataDir, runsDir, project, dir } = await setup();
  await writeFile(join(dir, 'outside.md'), BACKLOG);
  const no = async () => assert.fail('must not start a run');
  for (const input of [{ path: join(dir, 'outside.md') }, { content: BACKLOG, path: 'x.md' }, { content: '  \n' }]) {
    const r = await startBacklogImport(db, dataDir, runsDir, project, input, { start: no as never });
    assert.equal(r.ok, false);
  }
});

test('agentTasks keeps an import_key only when the backlog has it word for word', () => {
  const out = JSON.stringify([
    { import_key: 'AUTH-12', title: 'Log out everywhere' },
    { import_key: 'made-up', title: 'Export CSV' },
  ]);
  const r = agentTasks(out, 'AUTH-12: Log out everywhere\n- Export CSV');
  assert.ok(r.ok);
  assert.deepEqual(r.tasks.map((t) => t.importKey), ['AUTH-12', 'export-csv']);
  assert.equal(agentTasks('[]', 'x').ok, false);
});

test('agentTasks keeps type and parent; parent only when the backlog has it, type only when valid', () => {
  const out = JSON.stringify([
    { import_key: 'intl', title: 'Intl billing', type: 'epic' },
    { import_key: 'bic', title: 'Bill in currency', type: 'story', parent: 'intl' },
    { title: 'Minor units', type: 'feature', parent: 'made-up' },
  ]);
  const r = agentTasks(out, 'Intl billing {#intl}\nBill in currency {#bic parent=intl}\nMinor units');
  assert.ok(r.ok);
  assert.deepEqual(r.tasks.map((t) => [t.importKey, t.type, t.parentKey]), [
    ['intl', 'epic', undefined],
    ['bic', 'story', 'intl'],
    ['minor-units', undefined, undefined],
  ]);
});
