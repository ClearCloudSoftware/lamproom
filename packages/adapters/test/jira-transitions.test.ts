import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noTransitionMessage, pickTransition, type JiraTransition } from '../src/ticket/jira/transitions.ts';

const t = (id: string, name: string, toName: string): JiraTransition => ({
  id,
  name,
  to: { name: toName },
});

test('pickTransition: exact match wins; case-insensitive', () => {
  const list = [t('11', 'To Do', 'To Do'), t('21', 'In Progress', 'In Progress'), t('31', 'Done', 'Done')];
  assert.equal(pickTransition('done', list)?.id, '31');
  assert.equal(pickTransition('in progress', list)?.id, '21');
  assert.equal(pickTransition('backlog', list)?.id, '11'); // falls back to "To Do"
});

test('pickTransition: picks the first synonym that is available', () => {
  const list = [t('1', 'Resolve', 'Resolved'), t('2', 'Close', 'Closed')];
  // "done" tries Done → Closed → Resolved; Closed comes first in TARGETS.
  assert.equal(pickTransition('done', list)?.name, 'Close');
});

test('pickTransition: no match returns undefined', () => {
  const list = [t('1', 'Planning', 'Planning'), t('2', 'Blocked', 'Blocked')];
  assert.equal(pickTransition('done', list), undefined);
  assert.equal(pickTransition('in progress', list), undefined);
});

test('pickTransition: "in tasks" has no candidates', () => {
  const list = [t('1', 'Any', 'Any')];
  assert.equal(pickTransition('in tasks', list), undefined);
});

test('noTransitionMessage: names the available targets', () => {
  const msg = noTransitionMessage('done', [t('1', 'Start', 'Started'), t('2', 'Pause', 'Paused')]);
  assert.match(msg, /no Jira transition to 'done'/);
  assert.match(msg, /Started, Paused/);
});

test('noTransitionMessage: handles an empty list', () => {
  assert.match(noTransitionMessage('done', []), /none available/);
});
