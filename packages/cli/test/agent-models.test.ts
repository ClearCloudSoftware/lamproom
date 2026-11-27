import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderModel } from '@lamproom/core';
import { listAllAgentModels, offeredModels, readAgentModels, refreshAgentModels, type ListFn } from '../src/agent-models.ts';
import { updateAppSettings } from '../src/app-settings.ts';
import { writeJsonFile } from '../src/config.ts';
import { readOllamaList } from '../src/ollama.ts';
import type { ApprovedModel } from '../src/settings.ts';

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'lr-agent-models-')));
const value = <T>(r: { ok: true; value: T } | { ok: false; error: string }) => (r.ok ? r.value : assert.fail(r.error));
const m = (id: string, efforts: ProviderModel['efforts'] = ['low', 'high']): ProviderModel => ({ id, name: id, efforts });
const approved = (id: string, local?: true): ApprovedModel => ({ id, free: true, price: { in: 0, out: 0 }, approvedAt: '2026-11-27T00:00:00.000Z', ...(local && { local }) });
const T0 = new Date('2026-11-27T10:00:00Z');

/** A stand-in for each CLI: answers `--version` and `auth status`, so `harnessStatus` finds it installed. */
function stubs(data: string) {
  const bin = (name: string) => {
    const file = join(data, name);
    writeFileSync(file, '#!/bin/sh\necho 1.0.0\n');
    chmodSync(file, 0o755);
    return file;
  };
  value(updateAppSettings(data, { agents: { 'claude-code': { path: bin('claude'), model: 'sonnet', effort: null }, opencode: { path: bin('opencode'), model: null, effort: null } } }));
}

test('a refresh saves the list; a fresh one is not listed again, and maxAgeMs 0 lists anyway', async () => {
  const data = temp();
  let calls = 0;
  const list: ListFn = async () => (calls++, [m('sonnet')]);
  assert.equal(readAgentModels(data, 'claude-code'), null);
  const first = await refreshAgentModels(data, 'claude-code', undefined, list, T0);
  assert.deepEqual(first, { list: { fetchedAt: T0.toISOString(), models: [m('sonnet')] } });
  assert.deepEqual(readAgentModels(data, 'claude-code'), first.list);
  await refreshAgentModels(data, 'claude-code', undefined, list, new Date(T0.getTime() + 59 * 60_000));
  assert.equal(calls, 1);
  await refreshAgentModels(data, 'claude-code', 0, list, new Date(T0.getTime() + 60_000));
  assert.equal(calls, 2);
});

test('a list that throws, or never answers, keeps the old file and says why', async () => {
  const data = temp();
  const ok = await refreshAgentModels(data, 'claude-code', undefined, async () => [m('sonnet')], T0);
  const bad = await refreshAgentModels(data, 'claude-code', 0, async () => { throw new Error('not signed in'); }, T0);
  assert.deepEqual(bad, { list: ok.list, error: "could not list claude-code's models: not signed in" });
  const hung = await refreshAgentModels(data, 'claude-code', 0, () => new Promise(() => {}), T0, 20);
  assert.deepEqual(hung, { list: ok.list, error: "could not list claude-code's models: no answer in 0.02 s" });
  assert.deepEqual(readAgentModels(data, 'claude-code'), ok.list);
});

test("OpenCode's cell offers the approved ids of its list, and Ollama's approved models with no efforts; null before the first list", async () => {
  const data = temp();
  assert.equal(offeredModels(data, 'opencode'), null);
  writeJsonFile(join(data, 'agent-models', 'opencode.json'), { fetchedAt: T0.toISOString(), models: [m('openrouter/a/x'), m('openrouter/b/y')] });
  writeJsonFile(join(data, 'ollama-models.json'), { fetchedAt: T0.toISOString(), models: [{ id: 'ollama/q', name: 'q', free: true, price: { in: 0, out: 0 }, local: true, context: null, contextFrom: null, maxContext: null, size: 1 }, { id: 'ollama/r', name: 'r', free: true, price: { in: 0, out: 0 }, local: true, context: null, contextFrom: null, maxContext: null, size: 1 }] });
  value(updateAppSettings(data, { opencodeModels: [approved('openrouter/a/x'), approved('ollama/q', true)] }));
  assert.deepEqual(offeredModels(data, 'opencode'), [m('openrouter/a/x'), { id: 'ollama/q', name: 'q', efforts: [] }]);
  writeJsonFile(join(data, 'agent-models', 'claude-code.json'), { fetchedAt: T0.toISOString(), models: [m('sonnet')] });
  assert.deepEqual(offeredModels(data, 'claude-code'), [m('sonnet')]); // Claude: the whole list
});

test('app start: a CLI that fails does not stop the next, and one line names it', async () => {
  const data = temp();
  stubs(data);
  const lines: string[] = [];
  const list: ListFn = async (cli) => {
    if (cli === 'opencode') throw new Error('boom');
    return [m('sonnet')];
  };
  const never = (async () => assert.fail('Ollama asked with no local model approved')) as typeof fetch;
  await listAllAgentModels(data, list, (l) => lines.push(l), never);
  assert.deepEqual(readAgentModels(data, 'claude-code')?.models, [m('sonnet')]);
  assert.equal(readAgentModels(data, 'opencode'), null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /opencode/);
});

test('app start: a CLI that is not installed is not listed', async () => {
  const data = temp();
  value(updateAppSettings(data, { agents: { 'claude-code': { path: '/nonexistent/claude', model: 'sonnet', effort: null }, opencode: { path: '/nonexistent/opencode', model: null, effort: null } } }));
  await listAllAgentModels(data, async () => assert.fail('listed a CLI that is not there'), () => {});
});

/** A fetch that answers Ollama's endpoints from `routes`, path → JSON; a path not in it is refused like a closed port. */
const ollama = (routes: Record<string, unknown>) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const key = path === '/api/show' ? `/api/show ${JSON.parse(String(init?.body)).model}` : path;
    if (!(key in routes)) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as typeof fetch;
const ROUTES = {
  '/api/version': { version: '0.40.16' },
  '/api/tags': { models: [{ name: 'q', size: 1, capabilities: ['completion', 'tools'], details: {} }] },
  '/api/show q': { parameters: 'num_ctx 65536' },
  '/api/ps': { models: [] },
};

test('app start: Ollama is listed when an approved model is local, and not otherwise', async () => {
  const data = temp();
  stubs(data);
  const list: ListFn = async () => [m('sonnet')];
  await listAllAgentModels(data, list, () => {}, (async () => assert.fail('Ollama asked with no local model approved')) as typeof fetch);
  value(updateAppSettings(data, { opencodeModels: [approved('ollama/q', true)] }));
  await listAllAgentModels(data, list, () => {}, ollama(ROUTES));
  assert.deepEqual(readOllamaList(data)?.map((o) => o.id), ['ollama/q']);
});

test('app start: Ollama not answering keeps its saved list and logs its error line', async () => {
  const data = temp();
  stubs(data);
  value(updateAppSettings(data, { opencodeModels: [approved('ollama/q', true)] }));
  const list: ListFn = async () => [m('sonnet')];
  await listAllAgentModels(data, list, () => {}, ollama(ROUTES));
  const lines: string[] = [];
  await listAllAgentModels(data, list, (l) => lines.push(l), ollama({}));
  assert.deepEqual(readOllamaList(data)?.map((o) => o.id), ['ollama/q']);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Ollama does not answer on http:\/\/127\.0\.0\.1:11434/);
});
