import type { ITerminalAddon, Terminal } from '@xterm/xterm';
import { ImageAddon, type IImageAddonOptions } from '@xterm/addon-image';

/**
 * FIFO image cache per terminal, in MB of unpacked RGBA.
 * Addon default is 128 MB; keep this lower because Zync caches many shells.
 */
export const TERMINAL_IMAGE_STORAGE_LIMIT_MB = 32;

export type TerminalImageAddon = ITerminalAddon;

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
