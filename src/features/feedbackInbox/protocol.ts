/** Bounded, text-only inbox contract shared by UI consumers and validation tests. */
export interface InboxThread {
  kind: 'feedback' | 'survey';
  id: string;
  sequence: number;
  category: string;
  message: string;
  createdAt: string;
  closedAt: string | null;
  unread: number;
}
export interface InboxReply {
  sender: 'team' | 'user';
  id: string;
  sequence: number;
  message: string;
  createdAt: string;
  readAt: string | null;
}
export interface InboxSnapshot {
  threads: InboxThread[];
  unread: number;
  active: boolean;
  nextBefore: number;
}
export interface InboxReplies {
  replyTo: string | null;
  replies: InboxReply[];
  nextAfter: number;
}

const PAGE_SIZE = 50;
/** Merge refreshed summaries without losing paginated history or duplicating IDs. */
export function mergeThreadPages(
  current: InboxThread[],
  incoming: InboxThread[],
): InboxThread[] {
  const byId = new Map(current.map((thread) => [thread.id, thread]));
  for (const thread of incoming) byId.set(thread.id, thread);
  return [...byId.values()].sort((a, b) => b.sequence - a.sequence);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function responseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid inbox response');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 16000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error('Invalid inbox text');
  return value;
}
function identifier(value: unknown): string {
  const id = text(value, 36);
  if (!uuid.test(id)) throw new Error('Invalid inbox identifier');
  return id;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error('Invalid inbox count');
  return value as number;
}
function date(value: unknown): string {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error('Invalid inbox timestamp');
  return result;
}
function optionalDate(value: unknown): string | null {
  return value === null ? null : date(value);
}

/** Validate server data before it controls unread state or UI pagination. */
export function parseSnapshot(raw: unknown): InboxSnapshot {
  const data = responseObject(raw);
  if (
    !Array.isArray(data.threads) ||
    data.threads.length > PAGE_SIZE ||
    typeof data.active !== 'boolean'
  )
    throw new Error('Invalid inbox snapshot');
  return {
    unread: count(data.unread),
    active: data.active,
    nextBefore: count(data.nextBefore),
    threads: data.threads.map((rawThread) => {
      const item = responseObject(rawThread);
      const kind = item.kind ?? 'feedback';
      if (kind !== 'feedback' && kind !== 'survey')
        throw new Error('Invalid inbox source');
      return {
        kind,
        id: identifier(item.id),
        sequence: count(item.sequence),
        category: text(item.category, 64),
        message: text(item.message),
        createdAt: date(item.createdAt),
        closedAt: optionalDate(item.closedAt),
        unread: count(item.unread),
      };
    }),
  };
}
export function parseReplies(raw: unknown): InboxReplies {
  const data = responseObject(raw);
  if (!Array.isArray(data.replies) || data.replies.length > PAGE_SIZE)
    throw new Error('Invalid inbox replies');
  return {
    replyTo: data.replyTo == null ? null : identifier(data.replyTo),
    nextAfter: count(data.nextAfter),
    replies: data.replies.map((rawReply) => {
      const item = responseObject(rawReply);
      const sender = item.sender ?? 'team';
      if (sender !== 'team' && sender !== 'user') throw new Error('Invalid reply sender');
      return {
        sender,
        id: identifier(item.id),
        sequence: count(item.sequence),
        message: text(item.message),
        createdAt: date(item.createdAt),
        readAt: optionalDate(item.readAt),
      };
    }),
  };
}
