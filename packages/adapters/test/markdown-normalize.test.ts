import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMarkdown } from '../src/ticket/markdown/normalize.ts';

const here = import.meta.dirname;

test('parses PRD backlog shapes with acceptance_criteria and non_goals', async () => {
  const content = await readFile(join(here, 'fixtures/markdown/sample.md'), 'utf8');
  const tasks = parseMarkdown(content, 'markdown');

  assert.equal(tasks.length, 3);

  assert.equal(tasks[0]?.importKey, 'rotate-refresh-tokens-on-every-use');
  assert.equal(tasks[0]?.title, 'Rotate refresh tokens on every use');
  assert.equal(tasks[0]?.body, 'Short description.');
  assert.deepEqual(tasks[0]?.acceptanceCriteria, [
    'Users keep their session across the rotation.',
    'No window where both tokens are valid.',
  ]);
  assert.deepEqual(tasks[0]?.nonGoals, ['Revoking old tokens from other devices.']);
  assert.equal(tasks[0]?._hint.titleSlug, 'rotate-refresh-tokens-on-every-use');
  assert.equal(tasks[0]?._hint.upstream, undefined);

  assert.equal(tasks[1]?.importKey, 'backfill');
  assert.equal(tasks[1]?.title, 'Backfill the audit log');
  assert.equal(tasks[1]?.body, 'Historical rows need the new columns.');
  assert.equal(tasks[1]?._hint.upstream, 'backfill');
  assert.equal(tasks[1]?._hint.titleSlug, 'backfill-the-audit-log');

  assert.equal(tasks[2]?.importKey, 'rotate-refresh-tokens-on-every-use-2');
  assert.equal(tasks[2]?.title, 'Rotate refresh tokens on every use');
  assert.equal(tasks[2]?.body, 'A second task with the same title lands with a `-2` key.');
});

test('preserves body content verbatim including shell-metacharacters (Review Focus #5)', () => {
  const content = '## x\n\nbody with `backtick` and $(pwd) and ; rm -rf / inline.\n';
  const [t] = parseMarkdown(content, 'markdown');
  assert.equal(t?.body, 'body with `backtick` and $(pwd) and ; rm -rf / inline.');
});

test('# and #### headings do not open a task', () => {
  const content = '# top\n\n#### sub\n\n## only\n\nbody.\n';
  const tasks = parseMarkdown(content, 'markdown');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.title, 'only');
});

test('prose before the first ## is dropped', () => {
  const content = 'preamble\n\n## first\n\nbody.\n';
  const tasks = parseMarkdown(content, 'markdown');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.body, 'body.');
});

test('task without body sets body to undefined', () => {
  const content = '## only\n';
  const [t] = parseMarkdown(content, 'markdown');
  assert.equal(t?.body, undefined);
});

test('rejects a file with a duplicate explicit {#id}', () => {
  const content = '## X {#same}\n\n## Y {#same}\n';
  assert.throws(() => parseMarkdown(content, 'markdown'), /duplicate explicit id.*same/i);
});

test('accepts inline bold/italic/code in heading text', () => {
  const content = '## **Rotate** `tokens` _carefully_\n\nbody.\n';
  const [t] = parseMarkdown(content, 'markdown');
  assert.equal(t?.title, 'Rotate tokens carefully');
  assert.equal(t?._hint.titleSlug, 'rotate-tokens-carefully');
});

test('body spans multiple paragraphs until the next heading', () => {
  const content = '## a\n\npara one.\n\npara two.\n\n## b\n\nx.\n';
  const [t] = parseMarkdown(content, 'markdown');
  assert.equal(t?.body, 'para one.\n\npara two.');
});

test('body stops at acceptance criteria heading', () => {
  const content = '## a\n\nbefore.\n\n### Acceptance criteria\n\n- one\n\n### And after\n\nafter.\n';
  const [t] = parseMarkdown(content, 'markdown');
  // Body is only the prose before the first special section; prose after is dropped.
  assert.equal(t?.body, 'before.');
  assert.deepEqual(t?.acceptanceCriteria, ['one']);
});

test('shape B: bold bullets under a grouping heading are the tasks', () => {
  const content = [
    '## Backlog',
    '',
    '- **Filter list by status** — add a dropdown',
    '* **Export CSV**: from the table',
    '- **Log out everywhere {#auth-12}**',
    '- a plain bullet is not a task',
    '',
    '### Done when',
    '',
    '- every session ends',
    '',
    '### Out of scope',
    '',
    '- `src/legacy/**`',
    '',
  ].join('\n');
  const tasks = parseMarkdown(content, 'markdown');
  assert.deepEqual(tasks.map((t) => [t.importKey, t.title, t.body]), [
    ['filter-list-by-status', 'Filter list by status', 'add a dropdown'],
    ['export-csv', 'Export CSV', 'from the table'],
    ['auth-12', 'Log out everywhere', undefined],
  ]);
  assert.equal(tasks[0]?.acceptanceCriteria, undefined);
  assert.deepEqual(tasks[2]?.acceptanceCriteria, ['every session ends']);
  assert.deepEqual(tasks[2]?.nonGoals, ['src/legacy/**']);
});

test('AC is an alias for acceptance criteria', () => {
  const [t] = parseMarkdown('## a\n\n### AC\n\n- one\n', 'markdown');
  assert.deepEqual(t?.acceptanceCriteria, ['one']);
});

test('attribute block: {#id .type parent=key} sets the key, type and parent, in any order after #id', () => {
  const [epic, story, task] = parseMarkdown('## Intl billing {#intl .epic}\n\n## Bill in currency {#bic .story parent=intl}\n\n## Minor units {#mu parent=bic .task}\n', 'markdown');
  assert.deepEqual([epic!.importKey, epic!.type, epic!.parentKey], ['intl', 'epic', undefined]);
  assert.deepEqual([story!.type, story!.parentKey], ['story', 'intl']);
  assert.deepEqual([task!.type, task!.parentKey], ['task', 'bic']);
});
test('attribute block works on shape B bullets too', () => {
  const [t] = parseMarkdown('## Billing\n\n- **CHF symbol** {#chf .bug parent=bic} — shows $\n', 'markdown');
  assert.deepEqual([t!.importKey, t!.type, t!.parentKey, t!.title], ['chf', 'bug', 'bic', 'CHF symbol']);
  assert.equal(t!.body, 'shows $');
});
test('a block with an unknown type or token stays in the title, untyped', () => {
  const [a, b] = parseMarkdown('## A {#a .feature}\n\n## B {#b owner=me}\n', 'markdown');
  assert.equal(a!.title, 'A {#a .feature}'); assert.equal(a!.type, undefined);
  assert.equal(b!.title, 'B {#b owner=me}');
});
test('a block with two types stays in the title', () => {
  const [a] = parseMarkdown('## A {#a .bug .task}\n', 'markdown');
  assert.equal(a!.title, 'A {#a .bug .task}');
});
