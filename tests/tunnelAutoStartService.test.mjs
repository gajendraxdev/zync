import assert from 'node:assert/strict';
import {
  ensurePinnedFeature,
  getAutoStartTunnels,
  pinFeatureOnConnectionIfNeeded,
  startAutoStartTunnels,
} from '../.tmp-agent-tests/src/features/connections/application/tunnelAutoStartService.js';

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await runTest('getAutoStartTunnels filters only auto-start entries', () => {
  const tunnels = [
    { id: 't1', autoStart: true },
    { id: 't2', autoStart: false },
    { id: 't3' },
  ];
  const result = getAutoStartTunnels(tunnels);
  assert.deepEqual(result.map((t) => t.id), ['t1']);
});

await runTest('ensurePinnedFeature returns null when already pinned', () => {
  const result = ensurePinnedFeature(['port-forwarding'], 'port-forwarding');
  assert.equal(result, null);
});

await runTest('ensurePinnedFeature appends missing feature', () => {
  const result = ensurePinnedFeature(['files'], 'port-forwarding');
  assert.deepEqual(result, ['files', 'port-forwarding']);
});

await runTest('startAutoStartTunnels starts auto-start tunnels and swallows per-tunnel failure', async () => {
  const started = [];
  const errors = [];
  const tunnels = [
    { id: 't1', name: 'ok', autoStart: true },
    { id: 't2', name: 'fail', autoStart: true },
    { id: 't3', name: 'skip', autoStart: false },
  ];

  const count = await startAutoStartTunnels(
    tunnels,
    'c1',
    async (id) => {
      started.push(id);
      if (id === 't2') throw new Error('boom');
    },
    (tunnel, error) => errors.push(`${tunnel.id}:${String(error)}`),
  );

  assert.equal(count, 2);
  assert.deepEqual(started, ['t1', 't2']);
  assert.equal(errors.length, 1);
});

await runTest('pinFeatureOnConnectionIfNeeded updates only when feature missing', () => {
  let updated = null;
  const changed = pinFeatureOnConnectionIfNeeded(
    { id: 'c1', pinnedFeatures: ['files'] },
    'port-forwarding',
    (next) => { updated = next; },
  );
  assert.equal(changed, true);
  assert.deepEqual(updated.pinnedFeatures, ['files', 'port-forwarding']);

  updated = null;
  const unchanged = pinFeatureOnConnectionIfNeeded(
    { id: 'c1', pinnedFeatures: ['port-forwarding'] },
    'port-forwarding',
    (next) => { updated = next; },
  );
  assert.equal(unchanged, false);
  assert.equal(updated, null);
});

console.log('Tunnel auto-start service tests passed.');
