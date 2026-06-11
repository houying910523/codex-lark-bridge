import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCommand } from '../src/domain/commands.js';

test('parseCommand handles continue with prompt', () => {
  const parsed = parseCommand('/codex continue fix the flaky test');
  assert.deepEqual(parsed, {
    kind: 'continue',
    prompt: 'fix the flaky test',
    options: {
      syncLatest: false,
      readOnly: false,
      planOnly: false,
    },
  });
});

test('parseCommand handles sessions shortcut', () => {
  assert.deepEqual(parseCommand('/codex'), { kind: 'sessions' });
  assert.deepEqual(parseCommand('/codex sessions'), { kind: 'sessions' });
});
