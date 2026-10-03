import { useEffect, useRef, type RefObject } from 'react';
import { acknowledgeReply, type InboxReply } from './client';

/** Acknowledge visible reply footers only in a focused, foreground window.
 * Observing the footer also works for messages taller than the scroll viewport.
 */
export function useVisibleReplyReceipts(
  container: RefObject<HTMLDivElement | null>,
  replies: InboxReply[],
  onRefresh: () => void,
  onError: (message: string) => void,
) {
  const pending = useRef(new Set<string>());
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let disposed = false;
    const visible = new Set<string>();
    const attempted = new Set<string>();
    const acknowledgeVisible = () => {
      if (disposed || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const ids = [...visible].filter((id) => !pending.current.has(id) && !attempted.has(id));
      if (!ids.length) return;
      for (const id of ids) { pending.current.add(id); attempted.add(id); }
      void Promise.allSettled(ids.map(acknowledgeReply)).then((results) => {
        for (const id of ids) pending.current.delete(id);
        if (disposed) return;
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') onError('Could not update read status. Refresh the inbox to retry.');
        if (results.some((result) => result.status === 'fulfilled')) onRefresh();
      });
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.unreadReply;
        if (!id) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 1) visible.add(id);
        else visible.delete(id);
      }
      acknowledgeVisible();
    }, { threshold: 1 });
    root.querySelectorAll('[data-unread-reply]').forEach((element) => observer.observe(element));
    window.addEventListener('focus', acknowledgeVisible);
    document.addEventListener('visibilitychange', acknowledgeVisible);
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('focus', acknowledgeVisible);
      document.removeEventListener('visibilitychange', acknowledgeVisible);
    };
  }, [container, replies, onRefresh, onError]);
}
