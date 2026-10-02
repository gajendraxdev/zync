import { useRef, useState } from 'react';
import { MessageSquareOff } from 'lucide-react';
import { sendFollowUp } from './client';

/** Thread-keyed draft with stable retry identity; server authority determines each turn. */
export function FollowUpComposer({ thread, replyTo, disabled, onSent, onEndConversation }: {
  thread: string;
  replyTo: string | null;
  disabled: boolean;
  onSent: () => void;
  onEndConversation?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const retry = useRef<{ id: string; replyTo: string; message: string } | null>(null);
  const send = async () => {
    const message = draft.trim();
    if (inFlight.current || disabled || !replyTo || !message) return;
    inFlight.current = true;
    setSending(true);
    setError('');
    const attempt =
      retry.current?.message === message && retry.current.replyTo === replyTo
        ? retry.current
        : { id: crypto.randomUUID(), replyTo, message };
    retry.current = attempt;
    try {
      await sendFollowUp(thread, attempt.id, attempt.replyTo, attempt.message);
      retry.current = null;
      setDraft('');
      onSent();
    } catch (err) {
      setError(String(err));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  const endButton = onEndConversation && (
    <button type="button" onClick={onEndConversation} disabled={disabled || sending}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-app-border px-3 text-xs font-medium text-app-muted transition-colors hover:bg-app-surface hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:cursor-not-allowed disabled:opacity-50">
      <MessageSquareOff size={14} aria-hidden="true" />
      End conversation
    </button>
  );
  if (!replyTo && !sending) return (
    <div className="space-y-3 border-t border-app-border pt-3">
      <p className="text-xs text-app-muted">Waiting for the Zync team. You can reply after their next response.</p>
      <div className="flex justify-start">{endButton}</div>
    </div>
  );
  return (
    <form className="space-y-2 border-t border-app-border pt-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <label className="block text-xs text-app-muted" htmlFor={`followup-${thread}`}>Your reply</label>
      <textarea id={`followup-${thread}`} value={draft} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
          event.preventDefault();
          void send();
        }}
        disabled={disabled || sending} maxLength={4000} rows={3}
        className="w-full resize-y rounded-lg border border-app-border bg-app-surface p-3 text-sm text-app-text focus:border-app-accent focus:outline-none"
        placeholder="Add details or let us know if it helped…" />
      <p className="text-xs text-app-muted">One follow-up per team response · Ctrl/⌘+Enter to send</p>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        {endButton}
        <button type="submit" disabled={disabled || sending || !draft.trim() || !replyTo}
          className="h-9 shrink-0 rounded-lg bg-app-accent px-3 text-xs font-semibold text-app-bg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app-panel disabled:cursor-not-allowed disabled:opacity-50">
          {sending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </form>
  );
}
