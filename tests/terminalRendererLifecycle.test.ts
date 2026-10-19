import type { useTerminalLifecycle } from '../src/components/terminal/useTerminalLifecycle';
import { createInitialRendererState } from '../src/lib/terminal/types';
import type { Terminal } from '@xterm/xterm';
import { isTerminalDomMeasurable } from '../src/lib/terminal/terminalFit';

type Hook = typeof useTerminalLifecycle;
type Props = Parameters<Hook>[0];
type Cleanup = (() => void) | void;
type Effect = { run: () => Cleanup; deps: unknown[]; cleanup?: Cleanup };

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: ${actual} !== ${expected}`);
}

/** Execute the production hook with controlled React effects and paint frames. */
export async function runRendererLifecycleChecks(
  loadHook: (dependencies: Record<string, unknown>, globals: Record<string, unknown>) => { useTerminalLifecycle: Hook },
): Promise<void> {
  let checks = 0;
  function fixture() {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const refs: { current: unknown }[] = [];
    let cursor = 0;
    let effects: Effect[] = [];
    let previousEffects: Effect[] = [];
    let disposals = 0;
    let setups = 0;
    let fits = 0;
    let restores = 0;
    let finishSetup: (() => void) | undefined;
    const requestedFonts: number[] = [];
    const term = { options: {}, rows: 24, refresh() {} } as unknown as Props['termRef']['current'];
    const owner = { term };
    const cache = new Map<string, unknown>([['session', owner]]);
    const renderer: { kind: 'webgl' | 'dom'; webglAddon?: object; webglContextLossBlocked: boolean } = {
      kind: 'webgl', webglAddon: {}, webglContextLossBlocked: false,
    };
    const props = {
      containerRef: { current: null }, termRef: { current: term }, fitAddonRef: { current: null }, searchAddonRef: { current: null },
      activeConnectionId: 'local', sessionId: 'session', terminalKey: 'local', spawnConnectionId: 'local',
      isConnected: true, isVisible: true, isWorkspaceActive: true, isTerminalView: true, isActiveTab: true, remoteReady: true,
      terminalSettings: { gpuAcceleration: true, fontLigatures: false, fontFamily: 'monospace', fontSize: 14,
        lineHeight: 1, cursorStyle: 'block' }, resolveInitialTheme: () => ({}),
    } as Props;
    const { useTerminalLifecycle: hook } = loadHook({
      react: {
        useRef: (initial: unknown) => { const i = cursor++; return refs[i] ??= { current: initial }; },
        useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
        useState: (initial: unknown) => [initial, () => {}],
        useEffect: (run: () => Cleanup, deps: unknown[]) => effects.push({ run, deps }),
      },
      '@xterm/xterm': {}, '@xterm/addon-fit': {}, '@xterm/addon-search': {}, '@xterm/addon-web-links': {},
      '../../store/useAppStore': {},
      '../../lib/terminal/inputPipeline': {}, './useTerminalTheme': {},
      '../../lib/terminal/terminalDocument': {}, '../../lib/terminal/terminalShellContext': {},
      '../../lib/terminal': {
        terminalCache: cache, getTerminalRendererState: () => renderer,
        createResizeScheduler: () => ({ cancel() {}, schedule() {} }),
        buildEffectiveRendererSettings: (settings: unknown) => settings,
        needsTerminalRendererSetup: () => renderer.kind !== 'webgl' || !renderer.webglAddon,
        activateDomRenderer: async () => { disposals++; renderer.kind = 'dom'; renderer.webglAddon = undefined; },
        restoreTerminalDisplay: () => { restores++; }, safeFitTerminal: () => { fits++; return true; },
        applyTerminalRendererAndLigatures: (_id: string, _term: unknown, settings: { fontSize: number }) => {
          setups++;
          requestedFonts.push(settings.fontSize);
          return new Promise<void>(resolve => { finishSetup = resolve; });
        },
      },
    }, {
      requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId; },
      cancelAnimationFrame: (id: number) => frames.delete(id),
    });
    function render(changes: Partial<Props> = {}) {
      Object.assign(props, changes);
      effects = []; cursor = 0;
      hook(props);
      // Only commit through the renderer effect. Later effects own DOM, PTY and
      // resize integration, which are independent boundaries in this regression.
      const rendererIndex = effects.findIndex(effect => effect.deps[0] === props.sessionId
        && typeof effect.deps[1] === 'string' && effect.deps[1].includes('|'));
      if (rendererIndex < 0) throw new Error('Production renderer effect not registered');
      const current = effects.slice(0, rendererIndex + 1);
      current.forEach((effect, i) => {
        const previous = previousEffects[i];
        if (previous && effect.deps.length === previous.deps.length
          && effect.deps.every((value, j) => Object.is(value, previous.deps[j]))) {
          effect.cleanup = previous.cleanup;
        } else {
          previous?.cleanup?.();
          effect.cleanup = effect.run();
        }
      });
      previousEffects = current;
    }
    function paint() {
      const pending = [...frames.values()]; frames.clear();
      pending.forEach(callback => callback(0));
    }
    return { render, paint, renderer, cache, owner, props, requestedFonts,
      frames: () => frames.size, disposals: () => disposals, setups: () => setups, fits: () => fits, restores: () => restores,
      finishSetup: () => finishSetup?.(),
      unmount: () => { previousEffects.forEach(effect => effect.cleanup?.()); previousEffects = []; },
    };
  }
  for (const paintedFrames of [0, 1]) {
    const f = fixture();
    f.render(); f.paint(); f.paint(); f.finishSetup(); await Promise.resolve();
    f.render({ isVisible: false });
    if (paintedFrames) f.paint();
    f.render({ isVisible: true });
    f.paint(); f.paint();
    equal(f.disposals(), 0, `return before paint ${paintedFrames + 1} preserves foreground WebGL`);
    equal(f.renderer.kind, 'webgl', 'the active terminal stays GPU rendered');
    f.unmount(); checks++;
  }
  {
    const f = fixture(); f.render(); f.paint();
    f.render({ isVisible: false }); f.paint(); f.paint();
    equal(f.setups(), 0, 'a hidden terminal cannot run obsolete foreground setup');
    f.unmount(); checks++;
  }
  {
    const f = fixture(); f.render(); f.paint();
    f.render({ terminalSettings: { ...f.props.terminalSettings, fontSize: 18 } });
    f.paint(); f.paint();
    equal(f.setups(), 1, 'only the latest deferred settings apply');
    equal(f.requestedFonts[0], 18, 'superseded font settings never reach setup');
    f.unmount(); checks++;
  }
  {
    const f = fixture(); f.render({ isVisible: false }); f.paint(); f.paint();
    equal(f.disposals(), 1, 'a genuinely inactive shell releases WebGL after paint');
    f.render({ isVisible: true }); f.paint(); f.paint();
    equal(f.setups(), 1, 'a terminal already on DOM requests foreground setup');
    f.unmount(); checks++;
  }
  for (const change of ['unmount', 'owner', 'terminal', 'disconnect']) {
    const f = fixture(); f.render({ isVisible: false }); f.paint();
    if (change === 'unmount') f.unmount();
    if (change === 'owner') f.cache.set('session', { term: f.props.termRef.current });
    if (change === 'terminal') f.props.termRef.current = {} as NonNullable<Props['termRef']['current']>;
    if (change === 'disconnect') f.render({ isConnected: false });
    f.paint();
    equal(f.disposals(), 0, `${change} invalidates deferred renderer disposal`);
    f.unmount(); checks++;
  }
  {
    const f = fixture(); f.render({ isVisible: false }); f.paint();
    f.render({ isTerminalView: false }); f.paint(); f.paint();
    equal(f.disposals(), 0, 'feature overlay supersedes stale background disposal');
    f.unmount(); checks++;
  }
  {
    const f = fixture(); f.render(); f.paint(); f.paint();
    const priorFits = f.fits();
    f.render({ isVisible: false });
    f.finishSetup(); await Promise.resolve();
    equal(f.fits(), priorFits, 'obsolete setup completion cannot refit a background terminal');
    f.render({ isVisible: true }); f.paint(); f.paint();
    equal(f.setups(), 2, 'obsolete completion cannot mark its settings as applied');
    f.unmount(); checks++;
  }
  console.log(`Terminal deferred-renderer lifecycle checks passed (${checks}).`);
}

/** Drive the real controller and cleanup through gated imports and explicit xterm boundary fakes. */
export async function runRendererOwnershipChecks(
  load: (file: string, dependencies: Record<string, unknown>, globals?: Record<string, unknown>) => unknown,
): Promise<void> {
  type Controller = typeof import('../src/lib/terminal/rendererController');
  type Lifecycle = typeof import('../src/lib/terminal/rendererLifecycle');
  function fixture() {
    const lifecycle = load('lib/terminal/rendererLifecycle.ts', {
      './terminalFit.js': { isTerminalDomMeasurable },
    }) as Lifecycle;
    let state = createInitialRendererState();
    let constructions = 0, loads = 0, disposals = 0, focuses = 0, events = 0;
    let failActivation = false;
    const losses: Array<() => void> = [];
    let release!: () => void;
    class Addon {
      constructor() { constructions++; }
      onContextLoss(callback: () => void) { losses.push(callback); }
      dispose() { equal(doc.activeElement, null, 'blur precedes addon disposal'); disposals++; }
    }
    const module = new Promise(resolve => { release = () => resolve({ WebglAddon: Addon }); });
    const doc: { activeElement: unknown } = { activeElement: null };
    const textarea = { ownerDocument: doc };
    const term = {
      options: { cursorBlink: true }, textarea, rows: 24, refresh() {},
      element: { isConnected: true, clientWidth: 600, clientHeight: 300 },
      focus() { focuses++; doc.activeElement = textarea; },
      blur() { doc.activeElement = null; },
      loadAddon() { loads++; if (failActivation) throw new Error('activation failure'); },
    } as unknown as Terminal;
    term.focus();
    const controller = load('lib/terminal/rendererController.ts', {
      './rendererLifecycle.js': lifecycle,
      './terminalFit.js': { isTerminalDomMeasurable: () => true },
      './rendererPolicy.js': { resolveDesiredTerminalRenderer: (prefs: { gpuAcceleration: boolean; webglContextLossBlocked: boolean }) =>
        prefs.gpuAcceleration && !prefs.webglContextLossBlocked ? 'webgl' : 'dom' },
      './rendererSession.js': { getTerminalRendererState: () => state, hasTerminalRendererSession: () => !state.disposed },
      './webglCapability.js': { isWebgl2Available: () => true },
      '@xterm/addon-webgl': module,
    }, {
      window: { dispatchEvent() { events++; } },
      CustomEvent: class { constructor(public name: string, public options: unknown) {} },
      console: { warn() {} },
    }) as Controller;
    return { controller, lifecycle, term, doc, textarea, release, losses,
      state: () => state, replace: () => { state = createInitialRendererState(); },
      failActivation: () => { failActivation = true; },
      counts: () => ({ constructions, loads, disposals, focuses, events }) };
  }
  async function reachImport() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
  let checks = 0;
  {
    const f = fixture();
    const requests = Array.from({ length: 25 }, () => f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true }));
    requests.forEach(request => equal(request, requests[0], 'same-target requests reuse pending work'));
    await reachImport(); equal(f.counts().constructions, 0, 'lazy import is genuinely pending');
    f.release(); await Promise.all(requests);
    equal(f.counts().loads, 1, 'overlapping requests install exactly one addon');
    equal(f.state().loadPromise, null, 'completed work releases its promise');
    f.lifecycle.disposeTerminalRenderer(f.state(), f.term); checks++;
  }
  for (const finalGpu of [false, true]) {
    const f = fixture();
    const first = f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true });
    await reachImport();
    equal(f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: false }), first, 'GPU off joins the owner transition');
    if (finalGpu) equal(f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true }), first, 'latest GPU on joins the same transition');
    f.release();
    equal(await first, finalGpu ? 'webgl' : 'dom', 'latest GPU/DOM request wins');
    equal(f.counts().loads, finalGpu ? 1 : 0, 'obsolete GPU intent cannot install an addon');
    f.lifecycle.disposeTerminalRenderer(f.state(), f.term); checks++;
  }
  {
    const f = fixture();
    const stale = f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true });
    await reachImport();
    const closed = f.state(); f.lifecycle.disposeTerminalRenderer(closed, f.term);
    f.replace();
    const replacement = { ...f.term, loadAddon() {} } as unknown as Terminal;
    const fresh = f.controller.syncTerminalRenderer('s', replacement, { gpuAcceleration: true });
    f.release();
    equal(await stale, 'dom', 'closed owner cannot finish GPU initialization');
    equal(await fresh, 'webgl', 'same-id replacement initializes independently');
    equal(f.counts().constructions, 1, 'only the replacement constructs an addon');
    equal(closed.terminal, undefined, 'closed state releases its terminal reference');
    equal(f.state().terminal, replacement, 'late callbacks cannot replace current ownership');
    f.lifecycle.disposeTerminalRenderer(f.state(), replacement); checks++;
  }
  {
    const f = fixture(); f.release();
    await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true });
    const first = f.controller.reactivateTerminalWebgl('s', f.term);
    equal(f.controller.reactivateTerminalWebgl('s', f.term), first, 'reactivation reuses pending work');
    await first;
    equal(f.counts().loads, 2, 'reactivation installs one replacement');
    equal(f.counts().disposals, 1, 'reactivation disposes the previous renderer once');
    equal(f.doc.activeElement, f.textarea, 'live renderer replacement preserves focus');
    equal(f.term.options.cursorBlink, true, 'cleanup does not change cursor preferences');
    f.losses[0]();
    equal(f.state().webglContextLossBlocked, false, 'obsolete context-loss callbacks cannot block a replacement');
    await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: false });
    equal(f.doc.activeElement, f.textarea, 'DOM fallback preserves input focus');
    await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true });
    const beforeClose = f.counts();
    f.lifecycle.disposeTerminalRenderer(f.state(), f.term);
    equal(f.counts().focuses, beforeClose.focuses, 'teardown never refocuses a closed terminal');
    checks++;
  }
  {
    const f = fixture(); f.release(); f.failActivation();
    equal(await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true }), 'dom', 'activation failure falls back to DOM');
    equal(f.counts().disposals, 1, 'partially activated addon is disposed');
    equal(f.state().webglAddon, undefined, 'failed activation cannot leave an owned addon');
    equal(f.state().loadPromise, null, 'failed activation releases pending work');
    f.lifecycle.disposeTerminalRenderer(f.state(), f.term); checks++;
  }
  {
    const f = fixture();
    const pending = f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true });
    await reachImport();
    f.lifecycle.disposeTerminalRenderer(f.state(), f.term);
    f.release(); await pending;
    equal(f.counts().events, 0, 'closed import completion publishes no stale notification');
    equal(await f.controller.reactivateTerminalWebgl('s', f.term), 'dom', 'late reactivation cannot resurrect a closed owner');
    equal(f.counts().loads, 0, 'teardown during import never installs an addon'); checks++;
  }
  {
    const f = fixture(); f.release();
    await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true });
    let turnOff!: Promise<'webgl' | 'dom'>;
    await f.controller.reactivateTerminalWebgl('s', f.term, {
      onRefit() { turnOff = f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: false }); },
    });
    await turnOff;
    equal(f.state().kind, 'dom', 'synchronous refit requests are reconciled before settling');
    f.lifecycle.disposeTerminalRenderer(f.state(), f.term); checks++;
  }
  {
    const f = fixture(); f.release();
    await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true });
    f.losses[0](); await reachImport();
    equal(f.state().webglContextLossBlocked, true, 'current context loss blocks further GPU activation');
    equal(f.counts().disposals, 1, 'context loss still disposes JS listeners and cursor timers');
    equal(await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true }), 'dom', 'context loss remains DOM-only');
    f.lifecycle.disposeTerminalRenderer(f.state(), f.term); checks++;
  }
  {
    const f = fixture(); f.release();
    await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true });
    const before = f.counts().focuses;
    Object.defineProperty(f.term.element, 'clientWidth', { value: 0 });
    await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: false });
    equal(f.counts().focuses, before, 'background disposal cannot refocus a hidden terminal');
    f.lifecycle.disposeTerminalRenderer(f.state(), f.term); checks++;
  }
  {
    const f = fixture(); f.release();
    await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: true });
    const elsewhere = {};
    const addon = f.state().webglAddon!;
    const dispose = addon.dispose.bind(addon);
    addon.dispose = () => { dispose(); f.doc.activeElement = elsewhere; };
    await f.controller.syncTerminalRenderer('s', f.term, { gpuAcceleration: false });
    equal(f.doc.activeElement, elsewhere, 'cleanup cannot steal focus changed by another handler');
    f.lifecycle.disposeTerminalRenderer(f.state(), f.term); checks++;
  }
  console.log(`Terminal renderer ownership and cleanup checks passed (${checks}).`);
}
