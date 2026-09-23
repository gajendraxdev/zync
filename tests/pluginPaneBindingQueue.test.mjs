import assert from 'node:assert/strict';
import { PluginPaneBindingQueue } from '../.tmp-agent-tests/src/features/plugins/runtime/pluginPaneBindingQueue.js';

const queue = new PluginPaneBindingQueue();
const events = [];
let releaseFirstBind;
const firstBindGate = new Promise(resolve => { releaseFirstBind = resolve; });
let markFirstBindStarted;
const firstBindStarted = new Promise(resolve => { markFirstBindStarted = resolve; });

const firstBind = queue.enqueue('plugin\0pane', async () => {
  events.push('bind:first:start');
  markFirstBindStarted();
  await firstBindGate;
  events.push('bind:first:end');
});
const firstCleanup = queue.enqueue('plugin\0pane', async () => {
  events.push('unbind:first');
});
const replacementBind = queue.enqueue('plugin\0pane', async () => {
  events.push('bind:replacement');
});

await firstBindStarted;
assert.deepEqual(events, ['bind:first:start'], 'cleanup and replacement must wait for the first bind');
releaseFirstBind();
await Promise.all([firstBind, firstCleanup, replacementBind]);
assert.deepEqual(events, [
  'bind:first:start',
  'bind:first:end',
  'unbind:first',
  'bind:replacement',
]);

console.log('Plugin pane binding queue tests passed.');
