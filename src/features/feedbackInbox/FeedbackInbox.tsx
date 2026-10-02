import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { MessageSquare } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { ZPortal } from "../../components/ui/ZPortal";
import { getFeedbackInboxIdentity } from "./identity";
import {
  fetchInbox,
  feedbackInboxEnabled,
  INBOX_OPEN_EVENT,
  INBOX_REFRESH_EVENT,
  setInboxStream,
  type InboxSnapshot,
} from "./client";
import { InboxHistory } from "./InboxHistory";

const empty: InboxSnapshot = {
  threads: [],
  unread: 0,
  active: false,
  nextBefore: 0,
};

/** One app-level coordinator owns SSE and unread state independently of settings
 * or tab mounting. No polling interval and no startup credential enrollment.
 */
export function FeedbackInbox({ reminderVisible = false }: {
  /** Reserve space only while the survey reminder occupies the bottom corner. */
  reminderVisible?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(empty);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!feedbackInboxEnabled) return;
    let disposed = false,
      running = false,
      pending = false;
    let streaming = false;
    let online = navigator.onLine;
    const refresh = async () => {
      if (disposed) return;
      if (!online) return;
      if (running) {
        pending = true;
        return;
      }
      running = true;
      do {
        pending = false;
        try {
          const id = await getFeedbackInboxIdentity();
          const next = id ? await fetchInbox() : empty;
          if (disposed || !online) break;
          setSnapshot(next);
          setRevision((value) => value + 1);
          setError("");
          if (next.active !== streaming) {
            await setInboxStream(next.active);
            if (disposed || !online) break;
            streaming = next.active;
          }
        } catch (err) {
          if (!disposed) setError(String(err));
        }
      } while (pending && !disposed);
      running = false;
    };
    refreshRef.current = () => {
      void refresh();
    };
    const changed = () => {
      void refresh();
    };
    const disconnected = () => {
      streaming = false;
      if (!disposed)
        setError(
          "Live reply delivery is disconnected. Open or refresh the inbox to reconnect.",
        );
    };
    const show = () => {
      setOpen(true);
      changed();
    };
    const resume = () => {
      online = true;
      streaming = false;
      changed();
    };
    const pause = () => {
      online = false;
      streaming = false;
      void setInboxStream(false).catch(() => {});
    };
    const subscriptions = [
      listen("feedback-inbox-changed", changed),
      listen("feedback-inbox-disconnected", disconnected),
    ];
    window.addEventListener(INBOX_REFRESH_EVENT, changed);
    window.addEventListener(INBOX_OPEN_EVENT, show);
    window.addEventListener("online", resume);
    window.addEventListener("offline", pause);
    void Promise.all(subscriptions)
      .then(() => {
        if (!disposed) changed();
      })
      .catch((err) => {
        if (!disposed) setError(String(err));
      });
    return () => {
      disposed = true;
      refreshRef.current = () => {};
      window.removeEventListener(INBOX_REFRESH_EVENT, changed);
      window.removeEventListener(INBOX_OPEN_EVENT, show);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", pause);
      for (const subscription of subscriptions)
        void subscription.then((release) => release()).catch(() => {});
      void setInboxStream(false).catch(() => {});
    };
  }, []);
  const refresh = useCallback(() => refreshRef.current(), []);
  if (!feedbackInboxEnabled) return null;
  return (
    <>
      {snapshot.unread > 0 && !open && (
        <ZPortal passive className="absolute inset-0 z-[80]">
          <div className={`pointer-events-none absolute right-4 ${reminderVisible ? "bottom-24" : "bottom-12"}`}>
            <button
              onClick={() => {
                setOpen(true);
                refresh();
              }}
              aria-label={`${snapshot.unread} unread replies`}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-app-border bg-app-panel px-3 py-2 text-xs text-app-text shadow-xl"
            >
              <MessageSquare size={14} />
              <span>Replies</span>
              <span className="rounded-full bg-app-accent px-2 text-app-bg">
                {snapshot.unread}
              </span>
            </button>
          </div>
        </ZPortal>
      )}
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Replies inbox"
        subtitle="Survey and feedback conversations"
        width="max-w-sm"
        placement="bottom-right"
        backdrop="subtle"
        headerClassName="p-4"
        titleClassName="text-sm"
        contentClassName="p-0 min-h-0"
      >
        <div className="space-y-3 p-4 text-app-text">
          <p className="text-xs text-app-muted">
            Replies are private to this installation.
          </p>
          <button onClick={refresh} className="text-xs text-app-accent">
            Refresh inbox
          </button>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <InboxHistory
            snapshot={snapshot}
            revision={revision}
            onRefresh={refresh}
          />
        </div>
      </Modal>
    </>
  );
}
