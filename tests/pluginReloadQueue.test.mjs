import assert from 'node:assert/strict';
import { createPluginReloadQueue } from '../.tmp-agent-tests/src/features/plugins/runtime/pluginReloadQueue.js';

const enqueue = createPluginReloadQueue();
const events = [];
let releaseFirst;
const first = enqueue(async () => {
  events.push('first started');
  await new Promise(resolve => { releaseFirst = resolve; });
  events.push('first failed');
  throw new Error('reload failed');
});
const second = enqueue(async () => {
  events.push('second started');
  return true;
});

await Promise.resolve();
assert.deepEqual(events, ['first started']);
releaseFirst();
await assert.rejects(first, /reload failed/);
assert.equal(await second, true);
assert.deepEqual(events, ['first started', 'first failed', 'second started']);

console.log('Plugin reload serialization tests passed.');
