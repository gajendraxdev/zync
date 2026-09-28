import type { EditorView } from '@codemirror/view';

export function observeCodeMirrorLayout(
  container: HTMLElement,
  view: EditorView,
): () => void {
  let animationFrame: number | null = null;
  let lastWidth = 0;
  let lastHeight = 0;

  const scheduleMeasure = () => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      if (!view.dom.isConnected || container.clientWidth <= 0 || container.clientHeight <= 0) return;
      view.requestMeasure();
    });
  };

  const resizeObserver = new ResizeObserver(([entry]) => {
    const width = entry?.contentRect.width ?? container.clientWidth;
    const height = entry?.contentRect.height ?? container.clientHeight;
    if (width <= 0 || height <= 0) {
      lastWidth = 0;
      lastHeight = 0;
      return;
    }
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    scheduleMeasure();
  });

  const handleVisibilityChange = () => {
    if (!document.hidden) scheduleMeasure();
  };

  resizeObserver.observe(container);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  scheduleMeasure();

  return () => {
    resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  };
}
