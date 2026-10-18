import { useLayoutEffect, useState, type RefObject } from 'react';
import { filePanelLayout, type FilePanelLayout } from './filePanelLayout';

/** Observe the Files pane while publishing only changes to panel presentation. */
export function useFilePanelLayout(scope: RefObject<HTMLElement | null>): FilePanelLayout {
  const [layout, setLayout] = useState(() => filePanelLayout(0));

  useLayoutEffect(() => {
    const node = scope.current;
    if (!node) return;
    let measuredLayout: FilePanelLayout | undefined;
    const measure = () => {
      const width = node.clientWidth;
      // Retained, hidden panes have no usable measurement; keep their presentation
      // until they become visible instead of opening an inspector dialog on hide.
      if (width <= 0) return;
      const next = filePanelLayout(width);
      if (next === measuredLayout) return;
      measuredLayout = next;
      setLayout(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [scope]);

  return layout;
}
