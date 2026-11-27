import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMove, columnOf, STATUSES } from '../src/board.ts';

test('STATUSES: the ten columns in board order, owners as the note says', () => {
  assert.deepEqual(STATUSES.map((s) => s.id), ['backlog', 'needs-triage', 'needs-info', 'needs-context', 'ready-for-agent', 'ready-for-human', 'in tasks', 'in progress', 'done', 'wontfix']);
  assert.deepEqual(STATUSES.filter((s) => s.owner === 'you').map((s) => s.id), ['backlog', 'ready-for-agent', 'ready-for-human', 'done', 'wontfix']);
  assert.equal(STATUSES.find((s) => s.id === 'in tasks')!.owner, 'tasks');
});
test('columnOf: a container with an open child is in tasks; all closed with one done is done; all wontfix stays put', () => {
  assert.equal(columnOf('story', 'backlog', ['done', 'backlog']), 'in tasks');
  assert.equal(columnOf('story', 'backlog', ['done', 'wontfix']), 'done');
  assert.equal(columnOf('epic', 'backlog', ['wontfix']), 'backlog');
  assert.equal(columnOf('story', 'backlog', []), 'backlog');          // not split yet
  assert.equal(columnOf('story', 'wontfix', ['backlog']), 'wontfix'); // you closed it
  assert.equal(columnOf('task', 'ready-for-human', ['backlog']), 'ready-for-human');
});
test('canMove: free between your statuses; agents, runs and children own the rest', () => {
  assert.equal(canMove('task', 'backlog', 'ready-for-human'), '');
  assert.equal(canMove('task', 'needs-info', 'backlog'), '');
  assert.equal(canMove('task', 'backlog', 'backlog'), 'same');
  assert.match(canMove('task', 'backlog', 'needs-info'), /^Agents set needs-info/);
  assert.match(canMove('task', 'backlog', 'in progress'), /^Only a run/);
  assert.match(canMove('task', 'in progress', 'done'), /^A run owns this card/);
  assert.match(canMove('story', 'in tasks', 'done'), /moves with its children/);
  assert.match(canMove('task', 'backlog', 'in tasks'), /^Only an epic or story/);
  assert.match(canMove('epic', 'backlog', 'ready-for-agent'), /^An epic runs no flow/);
  assert.equal(canMove('epic', 'backlog', 'wontfix'), '');
});
