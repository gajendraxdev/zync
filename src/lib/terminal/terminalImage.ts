import type { ITerminalAddon, Terminal } from '@xterm/xterm';
import { ImageAddon, type IImageAddonOptions } from '@xterm/addon-image';

/**
 * FIFO image cache per terminal, in MB of unpacked RGBA.
 * Addon default is 128 MB; keep this lower because Zync caches many shells.
 */
export const TERMINAL_IMAGE_STORAGE_LIMIT_MB = 32;

export type TerminalImageAddon = ITerminalAddon;

type ImageAddonRenderer = {
  canvas?: unknown;
  removeLayerFromDom?: () => void;
};

type ImageAddonWithRenderer = {
  _renderer?: ImageAddonRenderer;
};

let imageLayerContextPatched = false;

/**
 * ImageAddon requests a desynchronized 2d context. After a resize (split),
 * Chromium/WebView2 composites that overlay as opaque black. Keep alpha, drop
 * desynchronized, and only for `.xterm-image-layer`.
 */
export function installImageLayerContextPatch(): void {
  if (imageLayerContextPatched) return;
  if (typeof HTMLCanvasElement === 'undefined') return;
  imageLayerContextPatched = true;
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    options?: CanvasRenderingContext2DSettings,
  ) {
    if (type === '2d' && this.classList?.contains('xterm-image-layer')) {
      return original.call(this, '2d', {
        ...(options ?? {}),
        alpha: true,
        desynchronized: false,
      });
    }
    return original.apply(this, arguments as unknown as Parameters<typeof original>);
  } as typeof original;
}

function getAddonRenderer(addon: object | undefined): ImageAddonRenderer | undefined {
  if (!addon || !('_renderer' in addon)) return undefined;
  return (addon as ImageAddonWithRenderer)._renderer;
}

/**
 * Drop the live overlay so the next render inserts a canvas at the current
 * pane size. Needed for the shell that existed before the split: setting
 * canvas.width on a desynchronized context leaves a black backing store.
 */
export function rebuildTerminalImageLayer(
  term: Pick<Terminal, 'refresh' | 'rows'>,
  addon?: object,
): void {
  const renderer = getAddonRenderer(addon);
  if (!renderer?.canvas || typeof renderer.removeLayerFromDom !== 'function') {
    return;
  }
  renderer.removeLayerFromDom();
  const lastRow = Math.max(0, term.rows - 1);
  try {
    term.refresh(0, lastRow);
  } catch {
    // Overlay is gone; the next xterm render recreates it.
  }
}

export function buildTerminalImageAddonOptions(): IImageAddonOptions {
  return {
    enableSizeReports: true,
    sixelSupport: true,
    sixelScrolling: true,
    iipSupport: true,
    storageLimit: TERMINAL_IMAGE_STORAGE_LIMIT_MB,
    showPlaceholder: true,
  };
}

export function createTerminalImageAddon(
  options: IImageAddonOptions = buildTerminalImageAddonOptions(),
): TerminalImageAddon {
  return new ImageAddon(options);
}

/** Load Sixel + iTerm IIP. Failures leave the terminal usable as text-only. */
export function loadTerminalImageAddon(
  term: Pick<Terminal, 'loadAddon'>,
  createAddon: () => TerminalImageAddon = createTerminalImageAddon,
): TerminalImageAddon | undefined {
  try {
    installImageLayerContextPatch();
    const addon = createAddon();
    term.loadAddon(addon);
    return addon;
  } catch (error) {
    console.warn('[terminal] Failed to load image addon', error);
    return undefined;
  }
}

export function disposeTerminalImageAddon(cached: { imageAddon?: TerminalImageAddon }): void {
  if (!cached.imageAddon) {
    return;
  }
  try {
    cached.imageAddon.dispose();
  } catch (error) {
    console.warn('[terminal] Failed to dispose image addon', error);
  }
  cached.imageAddon = undefined;
}
