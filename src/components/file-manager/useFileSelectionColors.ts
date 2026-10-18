import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { contrastingForeground } from '../../features/appearance/domain/colorContrast';

/** Resolve check contrast once per pane, not per row; CSS retains ownership of the accent fill. */
export function useFileSelectionColors(scope: RefObject<HTMLElement | null>): CSSProperties {
  const [foreground, setForeground] = useState<string | null>(null);
  useLayoutEffect(() => {
    const node = scope.current;
    if (!node) return;
    const root = node.ownerDocument;
    const view = root.defaultView;
    if (!view) return;
    let frame = 0;
    const read = () => setForeground(contrastingForeground(view.getComputedStyle(node).getPropertyValue('--color-app-accent')));
    const schedule = () => {
      view.cancelAnimationFrame(frame);
      frame = view.requestAnimationFrame(read);
    };
    // The global palette owner updates these attributes for builtin, custom and accent changes.
    const observer = new MutationObserver(schedule);
    for (const target of [root.body, root.documentElement]) {
      observer.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    }
    view.addEventListener('zync:theme-registry-ready', schedule);
    read();
    return () => {
      observer.disconnect();
      view.cancelAnimationFrame(frame);
      view.removeEventListener('zync:theme-registry-ready', schedule);
    };
  }, [scope]);
  return foreground ? { '--files-selection-foreground': foreground } as CSSProperties : {};
}
