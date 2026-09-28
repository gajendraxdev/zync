export interface CodeMirrorSessionSnapshot {
  savedContent: string;
  scrollLeft: number;
  scrollTop: number;
  state: unknown;
}

export interface CodeMirrorSessionCacheLimits {
  maxEntries: number;
  maxEntryCharacters: number;
  maxTotalCharacters: number;
}

export const DEFAULT_CODEMIRROR_SESSION_LIMITS: CodeMirrorSessionCacheLimits = {
  maxEntries: 8,
  maxEntryCharacters: 3 * 1024 * 1024,
  maxTotalCharacters: 8 * 1024 * 1024,
};

interface StoredSession {
  characters: number;
  snapshot: CodeMirrorSessionSnapshot;
}

function estimateSessionCharacters(snapshot: CodeMirrorSessionSnapshot) {
  try {
    return snapshot.savedContent.length + JSON.stringify(snapshot.state).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export class CodeMirrorSessionCache {
  private readonly sessions = new Map<string, StoredSession>();
  private totalCharacters = 0;

  constructor(private readonly limits = DEFAULT_CODEMIRROR_SESSION_LIMITS) {}

  save(key: string, snapshot: CodeMirrorSessionSnapshot) {
    this.delete(key);

    const characters = estimateSessionCharacters(snapshot);
    if (
      !Number.isFinite(characters) ||
      characters > this.limits.maxEntryCharacters ||
      characters > this.limits.maxTotalCharacters
    ) {
      return false;
    }

    this.sessions.set(key, { characters, snapshot });
    this.totalCharacters += characters;
    this.evictOverflow();
    return this.sessions.has(key);
  }

  take(key: string) {
    const stored = this.sessions.get(key);
    if (!stored) return null;

    this.sessions.delete(key);
    this.totalCharacters -= stored.characters;
    return stored.snapshot;
  }

  delete(key: string) {
    const stored = this.sessions.get(key);
    if (!stored) return;

    this.sessions.delete(key);
    this.totalCharacters -= stored.characters;
  }

  get size() {
    return this.sessions.size;
  }

  private evictOverflow() {
    while (
      this.sessions.size > this.limits.maxEntries ||
      this.totalCharacters > this.limits.maxTotalCharacters
    ) {
      const oldestKey = this.sessions.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.delete(oldestKey);
    }
  }
}

const sessionCache = new CodeMirrorSessionCache();

export function saveCodeMirrorSession(key: string, snapshot: CodeMirrorSessionSnapshot) {
  return sessionCache.save(key, snapshot);
}

export function takeCodeMirrorSession(key: string) {
  return sessionCache.take(key);
}

export function deleteCodeMirrorSession(key: string) {
  sessionCache.delete(key);
}
