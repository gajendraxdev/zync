import assert from 'node:assert/strict';
import {
  clearTerminalRendererSession,
  getTerminalRendererState,
  reactivateTerminalWebgl,
  syncTerminalRenderer,
} from '../.tmp-agent-tests/src/lib/terminal/index.js';

function runTest(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => console.log(`  ok ${name}`));
    }
    console.log(`  ok ${name}`);
    return undefined;
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

const SESSION = 'test-renderer-controller';
const mockTerm = { loadAddon: () => {}, rows: 24, refresh: () => {} };

async function runAll() {
  await runTest('sync falls back to dom when WebGL2 is unavailable (Node)', async () => {
    clearTerminalRendererSession(SESSION);
    const kind = await syncTerminalRenderer(SESSION, mockTerm, {
      gpuAcceleration: true,
    });
    const state = getTerminalRendererState(SESSION);
    assert.equal(kind, 'dom');
    assert.equal(state.webglContextLossBlocked, false);
    assert.equal(state.initFailureCount, 1);
    assert.equal(state.lastError, 'webgl2_unavailable');
    clearTerminalRendererSession(SESSION);
  });

  await runTest('init failure does not block later GPU sync attempts', async () => {
    clearTerminalRendererSession(SESSION);
    await syncTerminalRenderer(SESSION, mockTerm, {
      gpuAcceleration: true,
    });
    const kind = await syncTerminalRenderer(SESSION, mockTerm, {
      gpuAcceleration: true,
    });
    assert.equal(kind, 'dom');
    assert.equal(getTerminalRendererState(SESSION).webglContextLossBlocked, false);
    clearTerminalRendererSession(SESSION);
  });

  await runTest('context loss block keeps dom even when GPU is enabled', async () => {
    clearTerminalRendererSession(SESSION);
    const state = getTerminalRendererState(SESSION);
    state.webglContextLossBlocked = true;
    const kind = await syncTerminalRenderer(SESSION, mockTerm, {
      gpuAcceleration: true,
    });
    assert.equal(kind, 'dom');
    assert.equal(getTerminalRendererState(SESSION).webglContextLossBlocked, true);
    clearTerminalRendererSession(SESSION);
  });

  await runTest('gpu off during in-flight WebGL load settles on dom', async () => {
    clearTerminalRendererSession(SESSION);
    const state = getTerminalRendererState(SESSION);
    let releaseWebgl;
    const inFlightWebgl = new Promise((resolve) => {
      releaseWebgl = () => resolve('webgl');
    });
    state.loadPromise = inFlightWebgl;
    state.kind = 'dom';
    state.desiredKind = 'webgl';

    const domPromise = syncTerminalRenderer(SESSION, mockTerm, {
      gpuAcceleration: false,
    });
    assert.notEqual(domPromise, inFlightWebgl);

    releaseWebgl();
    const kind = await domPromise;
    assert.equal(kind, 'dom');
    assert.equal(state.kind, 'dom');
    assert.equal(state.webglAddon, undefined);
    assert.equal(state.desiredKind, 'dom');
    clearTerminalRendererSession(SESSION);
  });

  await runTest('gpu off after WebGL loads explicit dom renderer', async () => {
    clearTerminalRendererSession(SESSION);
    const state = getTerminalRendererState(SESSION);
    state.webglAddon = { dispose: () => {} };
    state.kind = 'webgl';
    state.desiredKind = 'webgl';
    const kind = await syncTerminalRenderer(SESSION, mockTerm, {
      gpuAcceleration: false,
    });
    assert.equal(kind, 'dom');
    assert.equal(state.kind, 'dom');
    assert.equal(state.webglAddon, undefined);
    clearTerminalRendererSession(SESSION);
  });

  await runTest('reactivate returns in-flight load promise when one exists', async () => {
    clearTerminalRendererSession(SESSION);
    const state = getTerminalRendererState(SESSION);
    let release;
    const inFlight = new Promise((resolve) => {
      release = () => resolve('dom');
    });
    state.loadPromise = inFlight;

    const concurrent = reactivateTerminalWebgl(SESSION, mockTerm, {});
    assert.equal(concurrent, inFlight);

    release();
    assert.equal(await concurrent, 'dom');
    clearTerminalRendererSession(SESSION);
  });

  await runTest('reactivate falls back to dom when WebGL2 is unavailable (Node)', async () => {
    clearTerminalRendererSession(SESSION);
    const kind = await reactivateTerminalWebgl(SESSION, mockTerm, {});
    const state = getTerminalRendererState(SESSION);
    assert.equal(kind, 'dom');
    assert.equal(state.initFailureCount, 1);
    clearTerminalRendererSession(SESSION);
  });

  console.log('Terminal renderer controller tests passed.');
}

runAll().catch((error) => {
  console.error(error);
  process.exit(1);
});