/** Observe native width lifecycle without inventing a separate content animation clock. */
export function hasRunningWidthTransition(element: HTMLElement): boolean {
  return element.getAnimations().some(animation => 'transitionProperty' in animation && animation.transitionProperty === 'width'
    && animation.effect !== null && (animation.playState === 'running' || animation.pending));
}

/**
 * Track independent sources within one layout boundary. Only first-start/last-end
 * changes notify React; each source releases its own membership when native motion ends.
 * A nested boundary reads its parent without publishing local motion to siblings.
 */
export function createLayoutMotionRegistry() {
  const sources = new Set<HTMLElement>();
  const listeners = new Set<() => void>();
  const isMoving = () => sources.size > 0;
  const setSource = (element: HTMLElement, moving: boolean) => {
    const previous = isMoving();
    if (moving) sources.add(element);
    else sources.delete(element);
    if (previous !== isMoving()) for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  return { isMoving, setSource, subscribe };
}
