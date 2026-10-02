import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageSquareOff } from "lucide-react";
import { FollowUpComposer } from "./FollowUpComposer";
import { useVisibleReplyReceipts } from "./useVisibleReplyReceipts";
import { mergeThreadPages } from "./protocol";
import {
  closeConversation,
  fetchInbox,
  fetchReplies,
  type InboxReply,
  type InboxSnapshot,
  type InboxThread,
} from "./client";

/** Own thread selection; only visible replies are acknowledged automatically.
 * Async history results are scoped to the selected thread.
 */
export function InboxHistory({
  snapshot,
  revision,
  onRefresh,
}: {
  snapshot: InboxSnapshot;
  revision: number;
  onRefresh: () => void;
}) {
  const [threads, setThreads] = useState(snapshot.threads);
  const [before, setBefore] = useState(snapshot.nextBefore);
  const [selected, setSelected] = useState<InboxThread | null>(null);
  const [replies, setReplies] = useState<InboxReply[]>([]);
  const [after, setAfter] = useState(0);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const generation = useRef(0);
  const hasLoadedOlder = useRef(false);
  const historyRef = useRef<HTMLDivElement>(null);
  useVisibleReplyReceipts(historyRef, replies, onRefresh, setError);
  useEffect(() => {
    setThreads((current) => mergeThreadPages(current, snapshot.threads));
    // Once pagination advances, a newest-page invalidation must not rewind it
    // (including an exhausted cursor) or remove an older selected conversation.
    if (!hasLoadedOlder.current) setBefore(snapshot.nextBefore);
  }, [snapshot]);
  useEffect(() => {
    const run = ++generation.current;
    setConfirmClose(false);
    setReplies([]);
    setAfter(0);
    setReplyTo(null);
    setError("");
    if (!selected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchReplies(selected.id)
      .then((page) => {
        if (generation.current === run) {
          setReplies(page.replies);
          setAfter(page.nextAfter);
          setReplyTo(page.replyTo);
        }
      })
      .catch((err) => {
        if (generation.current === run) setError(String(err));
      })
      .finally(() => {
        if (generation.current === run) setLoading(false);
      });
    return () => {
      ++generation.current;
    };
  }, [selected?.id, revision]);
  const action = async (work: () => Promise<unknown>) => {
    if (busy) return;
    const run = generation.current;
    setBusy(true);
    setError("");
    try {
      await work();
      onRefresh();
    } catch (err) {
      if (run === generation.current) setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  const loadReplies = async () => {
    if (!selected || loading || !after) return;
    const run = generation.current;
    setLoading(true);
    try {
      const page = await fetchReplies(selected.id, after);
      if (run === generation.current) {
        setReplies((old) => [
          ...old,
          ...page.replies.filter(
            (item) => !old.some((existing) => existing.id === item.id),
          ),
        ]);
        setAfter(page.nextAfter);
        setReplyTo(page.replyTo);
      }
    } catch (err) {
      if (run === generation.current) setError(String(err));
    } finally {
      if (run === generation.current) setLoading(false);
    }
  };
  const loadThreads = async () => {
    if (!before || loading) return;
    const run = generation.current;
    setLoading(true);
    try {
      const page = await fetchInbox(before);
      if (run === generation.current) {
        hasLoadedOlder.current = true;
        setThreads((old) => [
          ...old,
          ...page.threads.filter(
            (item) => !old.some((existing) => existing.id === item.id),
          ),
        ]);
        setBefore(page.nextBefore);
      }
    } catch (err) {
      if (run === generation.current) setError(String(err));
    } finally {
      if (run === generation.current) setLoading(false);
    }
  };
  const closed = Boolean(
    threads.find((item) => item.id === selected?.id)?.closedAt ||
    selected?.closedAt,
  );
  return (
    <div ref={historyRef} className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error} <button onClick={onRefresh}>Retry</button>
        </p>
      )}
      {!threads.length && (
        <p className="text-sm text-app-muted">
          No conversations yet. Choose in-app replies when submitting a survey
          or feedback.
        </p>
      )}
      <div className="min-w-0">
        {!selected && <div className="space-y-2">
          {threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => setSelected(thread)}
              className={`w-full rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent ${
                thread.unread > 0
                  ? 'border-app-accent/50 bg-app-accent/10 hover:bg-app-accent/15'
                  : 'border-app-border bg-app-surface hover:border-app-accent/50'
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-app-muted">
                  {thread.kind === 'survey' ? 'Survey' : 'Feedback'} · {thread.category} · {thread.closedAt ? 'Closed' : 'Open'}
                </span>
                {thread.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-app-accent px-2 py-0.5 text-[10px] font-semibold text-app-bg">
                    {thread.unread} new
                  </span>
                )}
              </span>
              <span className={`mt-1 block truncate ${thread.unread > 0 ? 'font-semibold text-app-text' : ''}`}>
                {thread.message}
              </span>
            </button>
          ))}
          {before > 0 && (
            <button
              disabled={loading}
              onClick={() => void loadThreads()}
              className="text-xs text-app-accent"
            >
              Older conversations
            </button>
          )}
        </div>}
        {selected && (
          <article className="min-w-0 space-y-3">
            <div className="flex items-center gap-2 border-b border-app-border pb-3">
              <button onClick={() => setSelected(null)} aria-label="Back to conversations" className="rounded p-1.5 text-app-muted hover:bg-app-surface hover:text-app-text">
                <ArrowLeft size={16} />
              </button>
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{selected.category}</p>
                <p className="text-xs text-app-muted">{selected.kind === "survey" ? "Survey" : "Feedback"} · {closed ? "Closed" : "Open"}</p>
              </div>
            </div>
            <div className="ml-6 rounded-2xl rounded-tr-sm border border-app-accent/20 bg-app-accent/10 p-3">
              <p className="mb-1 text-xs font-medium text-app-muted">You</p>
              <p className="whitespace-pre-wrap break-words text-sm">{selected.message}</p>
            </div>
            {loading && (
              <p role="status" className="text-xs text-app-muted">
                Loading…
              </p>
            )}
            {!loading && !replies.length && (
              <p className="text-xs text-app-muted">No replies yet.</p>
            )}
            {replies.map((reply) => (
              <div
                key={reply.id}
                className={`rounded-2xl border p-3 ${reply.sender === 'user' ? 'ml-6 rounded-tr-sm border-app-accent/20 bg-app-accent/10' : 'mr-6 rounded-tl-sm border-app-border bg-app-surface'}`}
              >
                <p className="mb-1 text-xs font-medium text-app-muted">{reply.sender === 'user' ? 'You' : 'Zync team'}</p>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {reply.message}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-app-muted">
                  <time data-unread-reply={reply.sender === 'team' && !reply.readAt ? reply.id : undefined}>
                    {new Date(reply.createdAt).toLocaleString()}
                  </time>
                </div>
              </div>
            ))}
            {after > 0 && (
              <button
                disabled={loading}
                onClick={() => void loadReplies()}
                className="text-xs text-app-accent"
              >
                More replies
              </button>
            )}
            {!closed && <FollowUpComposer key={selected.id} thread={selected.id} replyTo={replyTo}
              disabled={loading || busy || confirmClose}
              onSent={() => { setReplyTo(null); onRefresh(); }}
              onEndConversation={confirmClose ? undefined : () => setConfirmClose(true)} />}
            {!closed && confirmClose && (
                <div className="space-y-3 rounded-lg border border-app-border bg-app-surface p-3 text-xs">
                  <p className="font-medium text-app-text">End this conversation?</p>
                  <p className="leading-relaxed text-app-muted">
                    Your messages will stay in history. Neither you nor the Zync
                    team can send more replies, and this cannot be undone.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const id = selected.id;
                        await closeConversation(id);
                        // Preserve closure for a selection outside the newest page.
                        setSelected((current) =>
                          current?.id === id
                            ? { ...current, closedAt: new Date().toISOString() }
                            : current,
                        );
                      })
                    }
                    className="mr-2 rounded-md border border-app-border px-3 py-2 font-medium text-app-text hover:bg-app-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:opacity-50"
                  >
                    {busy ? "Ending…" : "End conversation"}
                  </button>
                  <button disabled={busy} onClick={() => setConfirmClose(false)} className="rounded-md px-3 py-2 text-app-muted hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:opacity-50">Keep open</button>
                </div>
              )}
            {closed && (
              <div role="status" className="flex items-start gap-3 rounded-lg border border-app-border bg-app-surface/60 p-3 text-app-muted">
                <MessageSquareOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-xs font-medium text-app-text">Conversation ended</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    This history stays available, but no more replies can be sent.
                  </p>
                </div>
              </div>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
