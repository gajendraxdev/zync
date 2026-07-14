import { useEffect, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import {
  getGhostPixelPosition,
  type GhostLayoutHint,
} from '../../lib/ghostSuggestions/cursorPosition';
import { segmentTerminalCells } from '../../lib/ghostSuggestions/displayWidth';

interface Props {
  term: Terminal;
  suggestion: string; // suffix only — caller passes '' to hide
  /** Local typed-line layout for SSH echo-lag compensation. */
  layout?: GhostLayoutHint | null;
}

/**
 * Renders a faded ghost-text completion at the end of the locally typed line.
 *
 * Position uses origin + typed length when the xterm caret lags behind remote
 * echo (SSH). Falls back to the live caret when echo has caught up.
 */
export function GhostSuggestionOverlay({ term, suggestion, layout }: Props) {
  const [pos, setPos] = useState({
    left: 0,
    top: 0,
    cellHeight: 0,
    cellWidth: 0,
  });

  useEffect(() => {
    if (!suggestion) return;

    let frameId = 0;
    let prevLeft = 0;
    let prevTop = 0;
    let prevCellWidth = 0;
    let prevCellHeight = 0;
    let stableFrames = 0;
    const STOP_AFTER = 5;

    const tick = () => {
      const next = getGhostPixelPosition(term, layout);
      if (
        next.left !== prevLeft
        || next.top !== prevTop
        || next.cellWidth !== prevCellWidth
        || next.cellHeight !== prevCellHeight
      ) {
        prevLeft = next.left;
        prevTop = next.top;
        prevCellWidth = next.cellWidth;
        prevCellHeight = next.cellHeight;
        stableFrames = 0;
        setPos(next);
      } else {
        stableFrames++;
      }
      if (stableFrames < STOP_AFTER) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    const startBurst = () => {
      stableFrames = 0;
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(tick);
    };

    startBurst();
    // User input and remote echo (write) both need a remeasure: lag compensation
    // depends on live cursor vs predicted end-of-line.
    const dataDisposable = term.onData(startBurst);
    const writeDisposable = term.onWriteParsed
      ? term.onWriteParsed(startBurst)
      : term.onRender(startBurst);
    const resizeDisposable = term.onResize(startBurst);

    return () => {
      window.cancelAnimationFrame(frameId);
      dataDisposable.dispose();
      writeDisposable.dispose();
      resizeDisposable.dispose();
    };
  }, [term, suggestion, layout?.typedCellCount, layout?.origin?.col, layout?.origin?.row]);

  if (!suggestion) return null;

  const fontFamily = term.options.fontFamily ?? 'monospace';
  const fontSize = Number(term.options.fontSize ?? 14);
  const fontWeight = term.options.fontWeight ?? 'normal';
  const cellHeight = pos.cellHeight > 0
    ? pos.cellHeight
    : fontSize * Number(term.options.lineHeight ?? 1.2);
  // Pin glyph advance to measured xterm cell width so the faded suffix cannot
  // drift left over already-typed characters when CSS mono metrics diverge.
  const cellWidth = pos.cellWidth > 0 ? pos.cellWidth : undefined;
  const segments = cellWidth ? segmentTerminalCells(suggestion) : null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: pos.left,
        top: pos.top,
        height: cellHeight,
        lineHeight: `${cellHeight}px`,
        pointerEvents: 'none',
        userSelect: 'none',
        fontFamily,
        fontSize: `${fontSize}px`,
        fontWeight,
        fontVariantLigatures: 'none',
        color: 'color-mix(in srgb, var(--color-app-muted, #94a3b8) 60%, transparent)',
        whiteSpace: 'pre',
        zIndex: 10,
        ...(cellWidth
          ? {
              display: 'flex',
              letterSpacing: 0,
            }
          : null),
      }}
    >
      {segments && cellWidth
        ? segments.map((seg, i) => (
            <span
              key={`${i}:${seg.text}`}
              style={{
                display: 'inline-block',
                // Wide CJK/emoji → 2 cells; combining-only clusters → skip width 0
                width: Math.max(seg.cells, 0) * cellWidth,
                minWidth: seg.cells > 0 ? undefined : 0,
                height: cellHeight,
                lineHeight: `${cellHeight}px`,
                textAlign: 'center',
                overflow: 'hidden',
              }}
            >
              {seg.text}
            </span>
          ))
        : suggestion}
    </div>
  );
}
