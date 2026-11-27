import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_DEFAULTS, type Effort, type ModelClasses } from '../../packages/cli/src/settings.ts';
import { blocking, aliasOf, notSet, withModel } from './classes-model.ts';

const flash = { id: 'openrouter/deepseek/deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', efforts: ['low', 'high', 'max'] as Effort[] };
const coder = { id: 'openrouter/qwen/qwen3-coder', name: 'qwen3-coder', efforts: [] };
const offered = [flash, coder];

test('changing the model keeps the effort if the new model lists it, else clears it', () => {
  assert.deepEqual(withModel({ model: coder.id, effort: 'high' }, flash.id, offered), { model: flash.id, effort: 'high' });
  assert.deepEqual(withModel({ model: coder.id, effort: 'medium' }, flash.id, offered), { model: flash.id, effort: null }); // no medium on flash
  assert.deepEqual(withModel({ model: flash.id, effort: 'high' }, coder.id, offered), { model: coder.id, effort: null }); // no levels at all
  assert.deepEqual(withModel(null, flash.id, offered), { model: flash.id, effort: null });
  assert.equal(withModel({ model: flash.id, effort: 'low' }, '', offered), null);
  assert.deepEqual(withModel({ model: 'a/b', effort: 'low' }, 'a/c', null), { model: 'a/c', effort: 'low' }); // list unknown: nothing to check
});

test('"N not set" counts empty cells and cells the save would refuse; Save is blocked only by the second', () => {
  const t: ModelClasses = structuredClone(APP_DEFAULTS.modelClasses);
  // Defaults: every OpenCode cell is empty, every Claude cell set.
  assert.equal(notSet(t, 'opencode', offered), 9);
  assert.equal(notSet(t, 'claude-code', null), 0);
  assert.equal(blocking(t, { 'claude-code': null, opencode: offered }), 0);
  t.profiles.balanced.fast.opencode = { model: flash.id, effort: null }; // cleared: needs a level
  t.profiles.budget.deep.opencode = { model: coder.id, effort: null }; // no levels: fine
  assert.equal(notSet(t, 'opencode', offered), 8);
  assert.equal(blocking(t, { 'claude-code': null, opencode: offered }), 1);
  t.profiles.balanced.fast.opencode = { model: flash.id, effort: 'low' };
  assert.equal(notSet(t, 'opencode', offered), 7);
  assert.equal(blocking(t, { 'claude-code': null, opencode: offered }), 0);
});

test('an alias shows where it points; default names the alias it matches', () => {
  const all = [
    { id: 'default', name: 'Default (recommended)', resolvesTo: 'claude-opus-5-5', efforts: [] },
    { id: 'opus', name: 'Opus 5.5', resolvesTo: 'claude-opus-5-5', efforts: [] },
    { id: 'claude-opus-4-8', name: 'Opus 4.8', efforts: [] },
  ];
  assert.equal(aliasOf(all[0], all), 'Opus 5.5');
  assert.equal(aliasOf(all[1], all), 'Opus 5.5');
  assert.equal(aliasOf(all[2], all), undefined);
});
