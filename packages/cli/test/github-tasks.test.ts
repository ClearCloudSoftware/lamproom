import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearGithubTasksCredential,
  githubTasksStatus,
  readGithubTasks,
  readGithubTasksCredential,
  writeGithubTasks,
} from '../src/github-tasks.ts';

test('writeGithubTasks round-trips through readGithubTasks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lr-gh-'));
  writeGithubTasks(dir, { pat: 'ghp_test123', defaultRepo: { owner: 'octokit', repo: 'octokit.js' } });
  const s = readGithubTasks(dir);
  assert.equal(s.pat, 'ghp_test123');
  assert.deepEqual(s.defaultRepo, { owner: 'octokit', repo: 'octokit.js' });
});

test('writeGithubTasks trims whitespace and drops empty fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lr-gh-'));
  writeGithubTasks(dir, { pat: '  ghp_abc   ', defaultRepo: { owner: '  acme ', repo: 'website ' } });
  const s = readGithubTasks(dir);
  assert.equal(s.pat, 'ghp_abc');
  assert.deepEqual(s.defaultRepo, { owner: 'acme', repo: 'website' });
});

test('writeGithubTasks with an all-empty payload deletes the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lr-gh-'));
  writeGithubTasks(dir, { pat: 'ghp_x' });
  assert.equal(readGithubTasks(dir).pat, 'ghp_x');
  writeGithubTasks(dir, {});
  assert.deepEqual(readGithubTasks(dir), {});
});

test('writeGithubTasks drops a defaultRepo with blank owner or repo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lr-gh-'));
  writeGithubTasks(dir, { pat: 'ghp_x', defaultRepo: { owner: '', repo: 'x' } });
  const s = readGithubTasks(dir);
  assert.equal(s.pat, 'ghp_x');
  assert.equal(s.defaultRepo, undefined);
});

test('clearGithubTasksCredential preserves defaultRepo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lr-gh-'));
  writeGithubTasks(dir, { pat: 'ghp_x', defaultRepo: { owner: 'o', repo: 'r' } });
  clearGithubTasksCredential(dir);
  const s = readGithubTasks(dir);
  assert.equal(s.pat, undefined);
  assert.deepEqual(s.defaultRepo, { owner: 'o', repo: 'r' });
});

test('githubTasksStatus shows connected=false when no PAT is saved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lr-gh-'));
  assert.deepEqual(githubTasksStatus(dir), { connected: false });
  writeGithubTasks(dir, { pat: 'ghp_x' });
  assert.equal(githubTasksStatus(dir).connected, true);
});

test('githubTasksStatus returns the defaultRepo but never the PAT', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lr-gh-'));
  writeGithubTasks(dir, { pat: 'ghp_secret', defaultRepo: { owner: 'a', repo: 'b' } });
  const st = githubTasksStatus(dir);
  assert.equal(st.connected, true);
  assert.deepEqual(st.defaultRepo, { owner: 'a', repo: 'b' });
  assert.equal((st as unknown as { pat?: string }).pat, undefined);
});

test('readGithubTasksCredential returns a github_pat credential when saved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lr-gh-'));
  writeGithubTasks(dir, { pat: 'ghp_x' });
  assert.deepEqual(readGithubTasksCredential(dir), { kind: 'github_pat', token: 'ghp_x' });
});

test('readGithubTasksCredential throws when no PAT is saved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lr-gh-'));
  assert.throws(() => readGithubTasksCredential(dir), /no PAT configured/);
});
