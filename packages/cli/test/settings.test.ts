import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAppSettings, updateAppSettings } from '../src/app-settings.ts';
import type { ProviderModel } from '@lamproom/core';
import { APP_DEFAULTS, AppSettingsSchema, cellProblem, MODELS_PAGE, OverridesSchema, resolveSettings } from '../src/settings.ts';

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'lr-settings-')));
const value = <T>(r: { ok: true; value: T } | { ok: false; error: string }) => (r.ok ? r.value : assert.fail(r.error));

test('app settings: defaults with no file, an edit is kept, a bad value is refused with why', () => {
  const data = temp();
  assert.deepEqual(readAppSettings(data), APP_DEFAULTS);
  value(updateAppSettings(data, { projectsFolder: '~/code', budget: { capUsd: 200, alertAt: 75, onLimit: 'ask' } }));
  assert.equal(readAppSettings(data).projectsFolder, '~/code');
  assert.equal(readAppSettings(data).budget.capUsd, 200);
  assert.equal(readAppSettings(data).trust, 'normal'); // untouched keys keep their defaults
  assert.deepEqual(updateAppSettings(data, { escalation: { channel: 'billing', nudgeMin: 5 } }), { ok: false, status: 400, error: 'a Slack channel, like #billing-alerts' });
  assert.deepEqual(updateAppSettings(data, { projectsFolder: 'code' }), { ok: false, status: 400, error: 'a folder path: absolute, or starting with ~/' });
  value(updateAppSettings(data, { projectsFolder: null }));
  assert.equal(readAppSettings(data).projectsFolder, null);
});

test('precedence: app, then the type, then the project; each value says where it came from', () => {
  const app = { ...APP_DEFAULTS, draft: true };
  const r = resolveSettings(app, 'software', { budget: { capUsd: 150, alertAt: 80, onLimit: 'pause' } });
  assert.deepEqual(r.trust, { value: 'normal', from: 'type' });
  assert.deepEqual(r.knowledge, { value: { serena: true, graphify: true, rebuild: 'push' }, from: 'type' });
  assert.deepEqual(r.budget, { value: { capUsd: 150, alertAt: 80, onLimit: 'pause' }, from: 'project' });
  assert.deepEqual(r.draft, { value: true, from: 'app' });
  assert.deepEqual(resolveSettings(app, 'software', { trust: 'untrusted' }).trust, { value: 'untrusted', from: 'project' });
});

test('overrides: every rule the wizard checks, with its message', () => {
  const bad = (ov: unknown) => OverridesSchema.safeParse(ov).error?.issues[0].message;
  assert.equal(bad({ budget: { capUsd: 0, alertAt: 80, onLimit: 'pause' } }), 'a dollar amount above 0');
  assert.equal(bad({ budget: { capUsd: null, alertAt: 80, onLimit: 'pause' } }), 'a dollar amount above 0');
  assert.equal(bad({ budget: { capUsd: 5, alertAt: 101, onLimit: 'pause' } }), 'alert at 1 to 100 percent');
  assert.equal(bad({ budget: { capUsd: 5, alertAt: 2.5, onLimit: 'pause' } }), 'alert at 1 to 100 percent');
  assert.equal(bad({ escalation: { channel: '#Billing', nudgeMin: 5 } }), 'a Slack channel, like #billing-alerts');
  assert.equal(bad({ escalation: { channel: '#ok', nudgeMin: 121 } }), '1 to 120 minutes');
  assert.ok(bad({ network: ['x'] })); // strict: nothing outside Settings
  assert.ok(bad({ trust: 'root' }));
  assert.equal(OverridesSchema.safeParse({ memory: true, draft: false }).success, true);
});

test('agents: only the program path is kept; a path the OS would refuse is refused', () => {
  const data = temp();
  assert.deepEqual(readAppSettings(data).agents, { 'claude-code': { path: null }, opencode: { path: null } });
  const agents = { 'claude-code': { path: '~/bin/claude' }, opencode: { path: null } };
  value(updateAppSettings(data, { agents }));
  assert.deepEqual(readAppSettings(data).agents, agents);
  const bad = (a: unknown) => updateAppSettings(data, { agents: a as typeof agents });
  assert.deepEqual(bad({ ...agents, 'claude-code': { path: 'claude' } }), { ok: false, status: 400, error: 'a program path: absolute, or starting with ~/' });
  assert.equal(bad({ ...agents, 'claude-code': { path: null, model: 'opus' } }).ok, false); // strict: no model any more
});

const opus: ProviderModel = { id: 'opus', name: 'Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] };
const flash: ProviderModel = { id: 'openrouter/deepseek/deepseek-v4.1-flash', name: 'DeepSeek flash', efforts: ['low', 'high', 'max'] };
const q: ProviderModel = { id: 'ollama/q', name: 'q', efforts: [] };

test('cellProblem: the model must be offered, and the effort one it lists', () => {
  assert.equal(cellProblem('claude-code', { model: 'opus', effort: null }, [opus]), 'opus needs an effort level: low, medium, high, xhigh, max');
  assert.equal(cellProblem('opencode', { model: flash.id, effort: 'medium' }, [flash]), `${flash.id} has no medium effort; it takes low, high, max`);
  assert.equal(cellProblem('opencode', { model: 'ollama/q', effort: 'low' }, [q]), 'ollama/q has no low effort; it takes none');
  assert.equal(cellProblem('opencode', { model: 'ollama/q', effort: null }, [q]), undefined);
  assert.equal(cellProblem('claude-code', { model: 'opus', effort: 'max' }, [opus]), undefined);
  assert.equal(cellProblem('claude-code', { model: 'gpt', effort: 'low' }, [opus]), 'gpt is not a claude-code model on this machine');
  assert.equal(cellProblem('opencode', { model: 'openrouter/x/y', effort: 'low' }, [flash]), `openrouter/x/y is not an approved model; approve it in ${MODELS_PAGE}`);
  // never listed: only the shape is checked
  assert.equal(cellProblem('claude-code', { model: 'opus', effort: null }, null), undefined);
  assert.equal(cellProblem('opencode', { model: 'anything/x', effort: null }, null), undefined);
});

test('model classes: the defaults pass the schema, and a fresh install saves them', () => {
  assert.equal(AppSettingsSchema.safeParse(APP_DEFAULTS).success, true);
  const d = APP_DEFAULTS.modelClasses;
  assert.equal(d.inUse, 'balanced');
  assert.deepEqual(d.profiles.balanced.fast['claude-code'], { model: 'haiku', effort: 'medium' });
  assert.deepEqual(d.profiles.quality.deep['claude-code'], { model: 'opus', effort: 'xhigh' });
  assert.equal(d.profiles.budget.standard.opencode, null);
  const data = temp();
  const saved = value(updateAppSettings(data, { modelClasses: d }));
  assert.deepEqual(saved.modelClasses, d);
  assert.deepEqual(readAppSettings(data).modelClasses, d);
});

test('model classes: a cell is checked against the CLI’s saved list on save; the message says where', () => {
  const data = temp();
  mkdirSync(join(data, 'agent-models'));
  writeFileSync(join(data, 'agent-models', 'claude-code.json'), JSON.stringify({ fetchedAt: '2026-11-27T00:00:00.000Z', models: [{ id: 'opus', name: 'Opus', efforts: ['low', 'high'] }, { id: 'sonnet', name: 'Sonnet', efforts: ['low', 'high'] }, { id: 'haiku', name: 'Haiku', efforts: ['low', 'high'] }] }));
  const mc = structuredClone(APP_DEFAULTS.modelClasses);
  // the defaults use medium and xhigh, which this list lacks
  assert.deepEqual(updateAppSettings(data, { modelClasses: mc }), { ok: false, status: 400, error: 'quality › deep › claude-code: opus has no xhigh effort; it takes low, high' });
  for (const p of Object.values(mc.profiles)) for (const c of Object.values(p)) c['claude-code'] = { model: 'sonnet', effort: 'low' };
  value(updateAppSettings(data, { modelClasses: mc }));
  mc.profiles.budget.fast['claude-code'] = { model: 'gpt', effort: 'low' };
  assert.deepEqual(updateAppSettings(data, { modelClasses: mc }), { ok: false, status: 400, error: 'budget › fast › claude-code: gpt is not a claude-code model on this machine' });
  mc.profiles.budget.fast['claude-code'] = { model: 'sonnet', effort: null }; // the shape lets it through; the list does not
  assert.deepEqual(updateAppSettings(data, { modelClasses: mc }), { ok: false, status: 400, error: 'budget › fast › claude-code: sonnet needs an effort level: low, high' });
});

test('old settings files: agents keep their path, an old internal entry falls back to its default, the rest is kept', () => {
  const data = temp();
  writeFileSync(join(data, 'settings.json'), JSON.stringify({
    trust: 'untrusted',
    agents: { 'claude-code': { path: null, model: 'opus', effort: 'high' }, opencode: { path: '/x/opencode', model: null, effort: null } },
    internal: { 'repo-analyst': { adapter: 'claude-code', model: 'sonnet', effort: null, budgetUsd: 0.5 } },
  }));
  const s = readAppSettings(data);
  assert.equal(s.trust, 'untrusted');
  assert.deepEqual(s.agents, { 'claude-code': { path: null }, opencode: { path: '/x/opencode' } });
  assert.deepEqual(s.internal, APP_DEFAULTS.internal);
  assert.deepEqual(s.modelClasses, APP_DEFAULTS.modelClasses);
});

test('the Lamproom address is an app setting, for the links in Slack', () => {
  const data = mkdtempSync(join(tmpdir(), 'lr-address-'));
  assert.equal(readAppSettings(data).address, 'http://localhost:3000');
  assert.deepEqual(updateAppSettings(data, { address: 'ftp://x' }), { ok: false, status: 400, error: 'a web address, like http://localhost:3000' });
  assert.deepEqual(updateAppSettings(data, { address: 'localhost:3000' }), { ok: false, status: 400, error: 'a web address, like http://localhost:3000' });
  assert.equal(updateAppSettings(data, { address: ' http://mac.local:3000/ ' }).ok, true);
  assert.equal(readAppSettings(data).address, 'http://mac.local:3000');
});
