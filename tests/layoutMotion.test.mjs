import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './helpers/loadSource.mjs';

const motion = loadSource('components/ui/layoutMotionRegistry.ts');
const transition = (remaining = 200, extra = {}) => ({ transitionProperty: 'width', playState: 'running', pending: false,
  currentTime: 300 - remaining, playbackRate: 1,
  effect: { getComputedTiming: () => ({ endTime: 300 }), getTiming: () => ({ easing: 'ease-out' }) }, ...extra });
const source = (...animations) => ({ getAnimations: () => animations });

test('native lifecycle ignores unrelated, completed, paused and detached effects', () => {
  assert.equal(motion.hasRunningWidthTransition(source(transition(100, { transitionProperty: 'opacity' }),
    transition(100, { playState: 'finished' }), transition(100, { playState: 'paused' }), transition(100, { effect: null }))), false);
  assert.equal(motion.hasRunningWidthTransition(source(transition(50))), true);
  assert.equal(motion.hasRunningWidthTransition(source(transition(150, { playState: 'paused', pending: true }))), true);
});

test('independent owners notify only first start and last end', () => {
  const registry = motion.createLayoutMotionRegistry();
  const first = source(transition(200));
  const second = source(transition(250));
  const changes = [];
  const unsubscribe = registry.subscribe(() => changes.push(registry.isMoving()));
  registry.setSource(first, true);
  registry.setSource(first, true);
  registry.setSource(second, true);
  registry.setSource(first, false);
  assert.equal(registry.isMoving(), true);
  registry.setSource(first, false);
  registry.setSource(second, false);
  assert.deepEqual(changes, [true, false]);
  unsubscribe();
  registry.setSource(first, true);
  assert.deepEqual(changes, [true, false]);
});

test('width lifecycle uses native events, ignores descendants, and releases cancellation/unmount ownership', () => {
  const effects = [], changes = [], listeners = new Map();
  const registry = motion.createLayoutMotionRegistry();
  let animations = [transition()];
  const element = { getAnimations: () => animations,
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type, callback) => { assert.equal(listeners.get(type), callback); listeners.delete(type); } };
  const { useLayoutWidthTransition } = loadSource('components/ui/LayoutMotion.tsx', {
    './layoutMotionRegistry': motion,
    react: { createContext: () => ({}), useContext: () => ({ setSource: registry.setSource }),
      useRef: current => ({ current }), useLayoutEffect: callback => effects.push(callback) },
    'react/jsx-runtime': {},
  }, { getComputedStyle: () => ({ position: 'relative' }) });
  useLayoutWidthTransition({ current: element }, { onMovingChange: moving => changes.push(moving) });
  const cleanup = effects[0]();
  effects[1]();
  assert.equal(registry.isMoving(), true, 'the commit registers motion before transitionrun');
  animations = [];
  listeners.get('transitionend')({ target: {}, propertyName: 'width' });
  listeners.get('transitionend')({ target: element, propertyName: 'opacity' });
  assert.equal(registry.isMoving(), true);
  listeners.get('transitioncancel')({ target: element, propertyName: 'width' });
  assert.equal(registry.isMoving(), false);
  animations = [transition(75)];
  listeners.get('transitionrun')({ target: element, propertyName: 'width' });
  assert.equal(registry.isMoving(), true);
  cleanup();
  assert.equal(registry.isMoving(), false);
  assert.equal(listeners.size, 0);
  assert.deepEqual(changes, [true, false, true, false]);
});

test('disabled pointer/overlay motion and fixed surfaces never claim sibling resize ownership', () => {
  for (const [enabled, position] of [[false, 'relative'], [true, 'fixed'], [true, 'absolute']]) {
    const effects = [];
    const registry = motion.createLayoutMotionRegistry();
    const element = { ...source(transition()), addEventListener() {}, removeEventListener() {} };
    const { useLayoutWidthTransition } = loadSource('components/ui/LayoutMotion.tsx', {
      './layoutMotionRegistry': motion,
      react: { createContext: () => ({}), useContext: () => ({ setSource: registry.setSource }),
        useRef: current => ({ current }), useLayoutEffect: callback => effects.push(callback) }, 'react/jsx-runtime': {},
    }, { getComputedStyle: () => ({ position }) });
    useLayoutWidthTransition({ current: element }, { enabled });
    const cleanup = effects[0]();
    effects[1]();
    assert.equal(registry.isMoving(), false);
    cleanup();
  }
});
