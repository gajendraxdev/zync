import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { fileHoverHint } from './fileGridLayout';
import type { FileEntry } from './types';

const HOVER_DELAY_MS = 120;
const VIEWPORT_PAD = 8;

export type FileHoverShow = (file: FileEntry, el: HTMLElement) => void;
export type FileHoverHide = () => void;

export function useFileHoverTip(
  delayMs: number = HOVER_DELAY_MS,
  dateTimeFormat: 'simple' | 'detailed' = 'simple',
): {
  tip: { text: string; x: number; y: number } | null;
  show: FileHoverShow;
  hide: FileHoverHide;
} {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const tipOpenRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current == null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const hide = useCallback(() => {
    const hadTimer = timerRef.current != null;
    clearTimer();
    if (!hadTimer && !tipOpenRef.current) return;
    tipOpenRef.current = false;
    setTip(null);
  }, [clearTimer]);

  const show = useCallback((file: FileEntry, el: HTMLElement) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (!el.isConnected) return;
      const rect = el.getBoundingClientRect();
      tipOpenRef.current = true;
      setTip({
        text: fileHoverHint(file, dateTimeFormat),
        x: rect.left + rect.width / 2,
        y: rect.bottom,
      });
    }, delayMs);
  }, [clearTimer, delayMs, dateTimeFormat]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { tip, show, hide };
}

export function FileHoverTip({
  text,
  x,
  y,
}: {
  text: string;
  x: number;
  y: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: y + VIEWPORT_PAD,
    left: x,
    transform: 'translateX(-50%)',
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const minCenter = VIEWPORT_PAD + width / 2;
    const maxCenter = window.innerWidth - VIEWPORT_PAD - width / 2;
    const left = Number.isFinite(maxCenter)
      ? Math.min(Math.max(x, minCenter), Math.max(minCenter, maxCenter))
      : x;
    let top = y + VIEWPORT_PAD;
    if (top + height > window.innerHeight - VIEWPORT_PAD) {
      top = y - VIEWPORT_PAD - height;
      if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
    }
    setStyle({
      position: 'fixed',
      top,
      left,
      transform: 'translateX(-50%)',
      visibility: 'visible',
    });
  }, [text, x, y]);

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none z-[99999] max-w-[16rem] rounded-md border border-app-border bg-app-panel/95 px-2.5 py-1.5 text-left text-xs font-medium leading-snug whitespace-pre-line text-app-text shadow-xl animate-in fade-in duration-150"
      style={style}
    >
      {text}
    </div>,
    document.body,
  );
}
