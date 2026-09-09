import assert from 'node:assert/strict';
import {
  beginPaneDividerDrag,
  beginPaneSplitIntro,
  createResizeScheduler,
  endPaneDividerDrag,
  endPaneSplitIntro,
  isPaneDividerDragging,
  isPaneSizeTransient,
} from '../.tmp-agent-tests/src/lib/terminal/terminalFit.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

function resetDrag() {
  while (isPaneDividerDragging()) {
    // tests must end the hold they created; leftover holds fail the suite
    throw new Error('pane transient hold leaked into the next test');
  }
}

runTest('pane divider drag holds nest and unmatched end is a no-op', () => {
  resetDrag();
  assert.equal(isPaneDividerDragging(), false);
  const first = beginPaneDividerDrag();
  assert.equal(isPaneDividerDragging(), true);
  const second = beginPaneDividerDrag();
  endPaneDividerDrag(first);
  assert.equal(isPaneDividerDragging(), true);
  endPaneDividerDrag(second);
  assert.equal(isPaneDividerDragging(), false);
  endPaneDividerDrag();
  assert.equal(isPaneDividerDragging(), false);
});

runTest('split intro shares the pane-size-transient hold with divider drag', () => {
  resetDrag();
  const intro = beginPaneSplitIntro();
  assert.equal(isPaneSizeTransient(), true);
  assert.equal(isPaneDividerDragging(), true);
  assert.equal(endPaneSplitIntro(intro), true);
  assert.equal(isPaneSizeTransient(), false);
  const intro2 = beginPaneSplitIntro();
  const drag = beginPaneDividerDrag();
  assert.equal(endPaneSplitIntro(intro2), false);
  assert.equal(isPaneSizeTransient(), true);
  endPaneDividerDrag(drag);
  assert.equal(isPaneSizeTransient(), false);
});

runTest('ending a split intro twice does not drop an active divider hold', () => {
  resetDrag();
  const intro = beginPaneSplitIntro();
  const drag = beginPaneDividerDrag();
  assert.equal(endPaneSplitIntro(intro), false);
  assert.equal(endPaneSplitIntro(intro), false);
  assert.equal(isPaneSizeTransient(), true);
  endPaneDividerDrag(drag);
  assert.equal(isPaneSizeTransient(), false);
});

runTest('resize scheduler forwards syncBackend on immediate runs', () => {
  const calls = [];
  const scheduler = createResizeScheduler((opts) => calls.push(opts), 60);
  scheduler.schedule({ immediate: true, syncBackend: false });
  assert.deepEqual(calls, [{ forceSync: false, syncBackend: false }]);
  scheduler.schedule({ immediate: true, forceSync: true });
  assert.equal(calls[1].forceSync, true);
  assert.equal(calls[1].syncBackend, true);
  scheduler.cancel();
});

console.log('Terminal fit tests passed.');
