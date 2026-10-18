import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode, type RefObject } from 'react';
import { createLayoutMotionRegistry, hasRunningWidthTransition } from './layoutMotionRegistry';

const LayoutMotionContext = createContext({ moving: false,
  setSource: (_element: HTMLElement, _moving: boolean) => {} });
const stationary = () => false;

/** Compose outer and local layout motion without propagating a drawer into unrelated panes. */
export function LayoutMotionScope({ children }: { children: ReactNode }) {
  const parent = useContext(LayoutMotionContext);
  const [registry] = useState(createLayoutMotionRegistry);
  const localMoving = useSyncExternalStore(registry.subscribe, registry.isMoving, stationary);
  const moving = parent.moving || localMoving;
  const value = useMemo(() => ({ moving, setSource: registry.setSource }), [moving, registry]);
  return <LayoutMotionContext.Provider value={value}>{children}</LayoutMotionContext.Provider>;
}

export function useLayoutMotion() { return useContext(LayoutMotionContext); }

/**
 * Register native width motion before paint and release it on completion, reversal,
 * reduced-motion cancellation or unmount. Out-of-flow surfaces do not resize siblings.
 * The optional callback preserves existing consumers of sidebar lifecycle events.
 */
export function useLayoutWidthTransition(ref: RefObject<HTMLElement | null>, {
  enabled = true, onMovingChange,
}: { enabled?: boolean; onMovingChange?: (moving: boolean) => void } = {}) {
  const { setSource } = useLayoutMotion();
  const enabledRef = useRef(enabled);
  const onChangeRef = useRef(onMovingChange);
  const syncRef = useRef<(() => void) | null>(null);
  enabledRef.current = enabled;
  onChangeRef.current = onMovingChange;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let active = false;
    const sync = () => {
      const position = getComputedStyle(element).position;
      const moving = enabledRef.current && position !== 'absolute' && position !== 'fixed'
        && hasRunningWidthTransition(element);
      setSource(element, moving);
      if (moving !== active) { active = moving; onChangeRef.current?.(moving); }
    };
    const onTransition = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'width') sync();
    };
    syncRef.current = sync;
    element.addEventListener('transitionrun', onTransition);
    element.addEventListener('transitionend', onTransition);
    element.addEventListener('transitioncancel', onTransition);
    return () => {
      syncRef.current = null;
      element.removeEventListener('transitionrun', onTransition);
      element.removeEventListener('transitionend', onTransition);
      element.removeEventListener('transitioncancel', onTransition);
      setSource(element, false);
      if (active) onChangeRef.current?.(false);
    };
  }, [ref, setSource]);
  useLayoutEffect(() => { syncRef.current?.(); });
}
