import { getCurrentWindow } from '@tauri-apps/api/window';
import { isUsageEnabled } from './enabled.js';
import { flushUsage, FLUSH_INTERVAL_MS } from './flush.js';

let started = false;
let intervalId: number | null = null;
let unlistenClose: (() => void) | null = null;

export function startUsageLifecycle(): void {
  if (started) return;
  started = true;
  void flushUsage(true);

  intervalId = window.setInterval(() => {
    if (!isUsageEnabled()) return;
    void flushUsage();
  }, FLUSH_INTERVAL_MS);

  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flushUsage(true);
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', () => { void flushUsage(true); });

  void getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await Promise.race([flushUsage(true), new Promise((resolve) => setTimeout(resolve, 2000))]);
    } finally {
      await getCurrentWindow().destroy();
    }
  }).then((unlisten) => {
    unlistenClose = unlisten;
  }).catch(() => {
    // browser / tests
  });
}

export function stopUsageLifecycle(): void {
  if (intervalId != null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  unlistenClose?.();
  unlistenClose = null;
  started = false;
}
