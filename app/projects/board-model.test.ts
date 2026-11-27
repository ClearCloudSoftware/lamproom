import assert from 'node:assert/strict';
import test from 'node:test';
import type { StatusId, TaskType } from '../../packages/core/src/board.ts';
import type { TaskRow } from './api.ts';
import { effectiveFilters, groupColumn, indexTasks } from './board-model.ts';

const t = (key: string, type: TaskType, status: StatusId, parent?: string): TaskRow => ({
  projectId: 'p',
  sourceId: 'md',
  importKey: key,
  title: key,
  body: null,
  labels: [],
  assignees: [],
  extras: {},
  type,
  parentKey: parent ?? null,
  status,
  acceptance: [],
  nonGoals: [],
  hint: { titleSlug: key },
  importedAt: '',
  updatedAt: '',
});

const ix = indexTasks([
  t('e1', 'epic', 'backlog'),
  t('s1', 'story', 'backlog', 'e1'),
  t('a', 'task', 'backlog', 's1'),
  t('b', 'task', 'ready-for-agent', 's1'),
  t('s2', 'story', 'backlog', 'e1'),
  t('e2', 'epic', 'backlog'),
  t('s3', 'story', 'backlog', 'e2'),
  t('c', 'task', 'backlog', 's3'),
  t('x', 'task', 'backlog'),
]);

test('backlog groups epic → story → task, then loose cards; all folded at first', () => {
  const g = groupColumn('backlog', ix, { type: 'all', epic: '' }, new Set());
  assert.deepEqual(g.epics.map((e) => e.head.importKey), ['e1', 'e2']);
  assert.deepEqual(g.epics[0]!.stories.map((s) => s.head.importKey), ['s1']);
  assert.deepEqual(g.epics[0]!.cards.map((c) => c.importKey), ['s2']);
  assert.equal(g.epics[0]!.folded, true);
  assert.deepEqual(g.loose.map((c) => c.importKey), ['x']);
  assert.equal(g.count, 4);
});
test('an expanded key opens exactly that group in that column', () => {
  const g = groupColumn('backlog', ix, { type: 'all', epic: '' }, new Set(['backlog:md:e1']));
  assert.equal(g.epics[0]!.folded, false);
  assert.equal(g.epics[1]!.folded, true);
});
test('picking an epic drops the epic level and everything outside it, the epic itself included', () => {
  const g = groupColumn('backlog', ix, { type: 'all', epic: 'md:e1' }, new Set());
  assert.deepEqual(g.epics, []);
  assert.deepEqual(g.stories.map((s) => s.head.importKey), ['s1']);
  assert.deepEqual(g.loose.map((c) => c.importKey), ['s2']);
});
test('an epic or story whose group is in this column is not also a loose card', () => {
  const g = groupColumn('in tasks', ix, { type: 'all', epic: '' }, new Set());
  assert.ok(!g.loose.some((c) => c.importKey === 'e1' || c.importKey === 's1'));
  assert.deepEqual(g.epics.map((e) => e.head.importKey), ['e1', 'e2']);
});
test('a missing or wrong-type parent leaves the card loose', () => {
  const ix2 = indexTasks([t('y', 'task', 'backlog', 'gone'), t('z', 'task', 'backlog', 'x'), t('x', 'task', 'backlog')]);
  assert.deepEqual(groupColumn('backlog', ix2, { type: 'all', epic: '' }, new Set()).loose.map((c) => c.importKey).sort(), ['x', 'y', 'z']);
});
test('a picked epic that no longer exists falls back to all epics', () => {
  assert.equal(effectiveFilters({ type: 'all', epic: 'md:gone' }, ix).epic, '');
  assert.equal(effectiveFilters({ type: 'all', epic: 'md:e1' }, ix).epic, 'md:e1');
});
test('the type filter hides other types but keeps their groups as headers', () => {
  const g = groupColumn('backlog', ix, { type: 'task', epic: '' }, new Set());
  assert.deepEqual(g.loose.map((c) => c.importKey), ['x']);
  assert.equal(g.epics[0]!.cards.length, 0);
});
test('rollup: a group counts all its children, wherever they sit', () => {
  const s1 = groupColumn('backlog', ix, { type: 'all', epic: '' }, new Set()).epics[0]!.stories[0]!;
  assert.deepEqual([s1.done, s1.total], [0, 2]);
});
test('columns follow the children, as the server does', () => {
  assert.deepEqual(
    ['e1', 's1', 's2', 'e2', 's3'].map((k) => ix.column.get(`md:${k}`)),
    ['in tasks', 'in tasks', 'backlog', 'in tasks', 'in tasks'],
  );
});
test('a cyclic or upside-down parent is ignored', () => {
  const ix3 = indexTasks([t('e', 'epic', 'backlog', 's'), t('s', 'story', 'backlog', 'e')]);
  assert.deepEqual([...ix3.kids.keys()], ['md:e']); // the story links up; the epic's own parent is ignored
});
test('the story filter keeps split stories: they show as cards inside their epic group', () => {
  const g = groupColumn('in tasks', ix, { type: 'story', epic: '' }, new Set());
  assert.deepEqual(g.epics.map((e) => e.head.importKey), ['e1', 'e2']);
  assert.deepEqual(g.epics.map((e) => e.cards.map((c) => c.importKey)), [['s1'], ['s3']]);
  assert.deepEqual(g.loose, []);
});
test('the epic filter shows an epic with no visible content as a loose card', () => {
  const g = groupColumn('in tasks', ix, { type: 'epic', epic: '' }, new Set());
  assert.deepEqual(g.epics, []);
  assert.deepEqual(g.loose.map((c) => c.importKey), ['e1', 'e2']);
});
test('in tasks with every type: an epic group per epic holding its story as a card; count is 4', () => {
  const g = groupColumn('in tasks', ix, { type: 'all', epic: '' }, new Set());
  assert.deepEqual(g.epics.map((e) => e.cards.map((c) => c.importKey)), [['s1'], ['s3']]);
  assert.equal(g.count, 4);
});
test('a picked epic counts only the tasks inside it, not the epic', () => {
  assert.equal(groupColumn('in tasks', ix, { type: 'all', epic: 'md:e1' }, new Set()).count, 1);
});
test('a picked id that exists but is not an epic falls back to all epics, and groupColumn does not throw', () => {
  assert.equal(effectiveFilters({ type: 'all', epic: 'md:x' }, ix).epic, '');
  assert.equal(groupColumn('backlog', ix, { type: 'all', epic: 'md:gone' }, new Set()).count, 4);
  assert.equal(groupColumn('backlog', ix, { type: 'all', epic: 'md:s1' }, new Set()).epics.length, 2);
});
