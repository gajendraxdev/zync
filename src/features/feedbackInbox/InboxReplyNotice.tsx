/** Explain where responses arrive before the user submits a survey or feedback. */
export function InboxReplyNotice() {
  return (
    <p className="text-xs leading-relaxed text-app-muted">
      If the Zync team responds, the reply will appear privately in this
      installation. No email is needed.
    </p>
  );
}
