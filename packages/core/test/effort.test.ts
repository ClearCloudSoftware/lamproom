import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effortsFrom } from '../src/ports/agent-provider.ts';

test('effortsFrom keeps efforts only, deduplicated, in EFFORTS order', () => {
  assert.deepEqual(effortsFrom(['max', 'none', 'low', 'high', 'low']), ['low', 'high', 'max']);
  assert.deepEqual(effortsFrom(['minimal']), []);
});
