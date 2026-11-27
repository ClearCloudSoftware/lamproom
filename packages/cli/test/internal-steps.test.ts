import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAppSettings, updateAppSettings } from '../src/app-settings.ts';
import { loadFlow } from '../src/flow-config.ts';
import { internalFlowText } from '../src/internal-steps.ts';
import { APP_DEFAULTS, type InternalStep, INTERNAL_STEPS } from '../src/settings.ts';

// ponytail: flow-config does not resolve `class` until Task 5 of the model-classes plan, so the loader still needs a model; this adds one. Remove with that task.
const withModel = (text: string, model: string) => { const f = parse(text); return stringify({ ...f, defaults: { ...f.defaults, model } }); };
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'lr-internal-')));

test('internal steps: each loads from any folder with the app’s settings applied, and keeps its fixed tools', () => {
  for (const id of Object.keys(INTERNAL_STEPS) as InternalStep[]) {
    const dir = temp();
    writeFileSync(join(dir, 'task.md'), 'Analyse this.\n');
    const cfg = { adapter: 'opencode' as const, class: 'deep' as const, budgetUsd: 0.1 };
    assert.deepEqual(parse(internalFlowText(id, cfg)).defaults, { adapter: 'opencode', class: 'deep' });
    writeFileSync(join(dir, `${id}.yaml`), withModel(internalFlowText(id, cfg), 'openrouter/deepseek/deepseek-v4.1-flash'));
    const r = loadFlow(`${id}.yaml`, dir, { folder: dir, task: 'task.md' });
    assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'));
    const [step] = Object.values(r.config.steps);
    assert.equal(r.config.budgetUsd, 0.1);
    assert.ok(step.kind === 'ai');
    assert.equal(step.run.adapter, 'opencode');
    assert.ok(step.run.spec.toolPolicy?.deny?.includes('Bash'), `${id} must never get a shell`);
    // The defaults load too: what a fresh install runs.
    writeFileSync(join(dir, `${id}.yaml`), withModel(internalFlowText(id, APP_DEFAULTS.internal[id]), 'sonnet'));
    assert.ok(loadFlow(`${id}.yaml`, dir, { folder: dir, task: 'task.md' }).ok);
  }
});

test('internal settings: saved app-wide; a class that does not exist, or no budget, is refused', () => {
  const data = temp();
  const internal = { ...APP_DEFAULTS.internal, 'backlog-importer': { adapter: 'claude-code' as const, class: 'deep' as const, budgetUsd: 1 } };
  assert.ok(updateAppSettings(data, { internal }).ok);
  assert.deepEqual(readAppSettings(data).internal, internal);
  const bad = (step: unknown) => updateAppSettings(data, { internal: { ...internal, 'repo-analyst': step as typeof internal['repo-analyst'] } });
  assert.equal(bad({ adapter: 'opencode', class: 'huge', budgetUsd: 1 }).ok, false);
  assert.deepEqual(bad({ adapter: 'claude-code', class: 'fast', budgetUsd: 0 }), { ok: false, status: 400, error: 'a dollar amount above 0' });
});
