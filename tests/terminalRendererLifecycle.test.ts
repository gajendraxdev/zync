import type { useTerminalLifecycle } from '../src/components/terminal/useTerminalLifecycle';

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
