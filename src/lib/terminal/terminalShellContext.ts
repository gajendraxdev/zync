import type { Terminal } from '@xterm/xterm';

/** A conservative shell-input gate, not tmux detection or a security boundary. */
export function canTrackTerminalShell(term: Pick<Terminal, 'buffer' | 'modes'>, paused = false): boolean {
  return !paused && term.buffer.active.type === 'normal' && term.modes.mouseTrackingMode === 'none';
}

/** Observe public terminal modes without consuming any escape sequence. No
 * polling: consumers call sync before input and xterm notifies output changes. */
export function observeTerminalShellContext(
  term: Pick<Terminal, 'buffer' | 'modes' | 'parser' | 'onWriteParsed'>,
  options: { isPaused: () => boolean; generation: () => number; invalidate: () => void },
): { sync: () => void; dispose: () => void } {
  let safe = canTrackTerminalShell(term, options.isPaused());
  let generation = options.generation();
  if (!safe) options.invalidate();
  const sync = () => {
    const nextSafe = canTrackTerminalShell(term, options.isPaused());
    const nextGeneration = options.generation();
    if (safe !== nextSafe || generation !== nextGeneration) {
      const firstSpawn = generation === 0 && safe && nextSafe;
      safe = nextSafe;
      generation = nextGeneration;
      if (!firstSpawn) options.invalidate();
    }
  };
  const buffer = term.buffer.onBufferChange(sync);
  const parsed = term.onWriteParsed(sync);
  // Catch reporting-mode round trips inside a single write, even when the final
  // state is normal. Returning false leaves actual mode handling to xterm.
  const mouseModes = new Set([9, 1000, 1002, 1003]);
  const observeMouseMode = (params: (number | number[])[]) => {
    if (params.some(value => typeof value === 'number' && mouseModes.has(value))) options.invalidate();
    return false;
  };
  const set = term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, observeMouseMode);
  const reset = term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, observeMouseMode);
  return {
    sync,
    dispose: () => { buffer.dispose(); parsed.dispose(); set.dispose(); reset.dispose(); },
  };
}
