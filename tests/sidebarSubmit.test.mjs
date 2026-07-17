import assert from 'node:assert/strict';
import {
  submitAgentGoal,
  submitAskQuery,
} from '../.tmp-agent-tests/src/components/ai/sidebarSubmit.js';

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await runTest('submitAskQuery collects context then submits', async () => {
  const calls = [];
  await submitAskQuery({
    trimmed: 'hello',
    connectionId: 'c1',
    resetInput: () => calls.push('reset'),
    collectContext: async () => {
      calls.push('ctx');
      return { os: 'linux' };
    },
    submitAiQuery: async (query, context, connectionId) => {
      calls.push({ query, context, connectionId });
    },
  });

  assert.deepEqual(calls, [
    'ctx',
    { query: 'hello', context: { os: 'linux' }, connectionId: 'c1' },
    'reset',
  ]);
});

await runTest('submitAgentGoal starts a run with history and approved plan', async () => {
  const calls = [];
  await submitAgentGoal({
    goal: 'restart nginx',
    agentRunning: false,
    agentScope: 'global',
    connectionId: null,
    connectionLabel: null,
    resetInput: () => calls.push('reset'),
    collectContext: async () => ({ os: 'linux' }),
    agentActions: {
      getHistory: () => [{ role: 'user', text: 'prev' }],
      getLastApprovedPlan: () => null,
      startRun: (scope, runId, goal) => calls.push({ startRun: { scope, runId, goal } }),
      addError: () => {},
      endRun: () => {},
    },
    startAgentRun: async (payload) => {
      calls.push({
        startAgentRun: {
          goal: payload.goal,
          history: payload.history,
          connectionId: payload.connectionId,
        },
      });
    },
  });

  assert.equal(calls[0].startRun.scope, 'global');
  assert.equal(calls[0].startRun.goal, 'restart nginx');
  assert.equal(typeof calls[0].startRun.runId, 'string');
  assert.deepEqual(calls[1].startAgentRun, {
    goal: 'restart nginx',
    history: [{ role: 'user', text: 'prev' }],
    connectionId: null,
  });
  assert.equal(calls[2], 'reset');
});

console.log('Sidebar submit tests passed.');
