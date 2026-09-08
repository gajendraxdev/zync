export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

export function matchAlertPrefix(text: string): { kind: AlertKind; rest: string } | null {
  const trimmed = text.trimStart();
  const match = trimmed.match(ALERT_RE);
  if (!match) return null;
  return {
    kind: match[1].toLowerCase() as AlertKind,
    rest: trimmed.slice(match[0].length).trimStart(),
  };
}

/** Strip `[!NOTE]` from the first string part only; later parts keep their markup. */
export function stripAlertPrefixFromParts(parts: unknown[]): unknown[] {
  let stripped = false;
  const out: unknown[] = [];
  for (const part of parts) {
    if (!stripped && typeof part === 'string') {
      const alert = matchAlertPrefix(part);
      if (alert) {
        stripped = true;
        if (alert.rest) out.push(alert.rest);
        continue;
      }
    }
    out.push(part);
  }
  return out;
}
