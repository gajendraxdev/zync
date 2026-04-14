import { useEffect, useState } from 'react';
import type { Terminal } from 'xterm';
import { getCursorPixelPosition } from '../../lib/ghostSuggestions/cursorPosition';

interface Props {
  term: Terminal;
  suggestion: string; // suffix only — caller passes '' to hide
}

/**
 * Renders a faded ghost-text completion at the xterm cursor position.
 *
 * Positioned absolutely inside the terminal container div (which already has
 * `position: relative` via the `terminal-container` class). Font values are
 * read from the public `term.options` API so they always match the live xterm
 * settings without relying on CSS variables that don't exist for the terminal.
 */
export function GhostSuggestionOverlay({ term, suggestion }: Props) {
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!suggestion) return;
    let frameId = 0;

    const tick = () => {
      const next = getCursorPixelPosition(term);
      setPos((prev) => (prev.left === next.left && prev.top === next.top ? prev : next));
      frameId = window.requestAnimationFrame(tick);
    };

    tick();

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [term, suggestion]);

  if (!suggestion) return null;

  const fontFamily = term.options.fontFamily ?? 'monospace';
  const fontSize   = `${term.options.fontSize   ?? 14}px`;
  const lineHeight = term.options.lineHeight ?? 1.2;

  return (
    <div
      aria-hidden="true"
      style={{
        position:    'absolute',
        left:        pos.left,
        top:         pos.top,
        pointerEvents: 'none',
        userSelect:  'none',
        fontFamily,
        fontSize,
        lineHeight,
        color:       'color-mix(in srgb, var(--color-app-muted, #94a3b8) 60%, transparent)',
        whiteSpace:  'pre',
        zIndex:      10,
      }}
    >
      {suggestion}
    </div>
  );
}
