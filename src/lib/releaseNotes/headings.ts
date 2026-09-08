export interface TocEntry {
  id: string;
  text: string;
  level: 1 | 2 | 3;
}

export function normalizeHeadingText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function headingKey(text: string): string {
  return normalizeHeadingText(text).toLowerCase().replace(/[^a-z]/g, '');
}

export function slugify(text: string, usedSlugs: Map<string, number>): string {
  const normalized = normalizeHeadingText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const baseSlug = normalized || 'section';

  if (usedSlugs.has(baseSlug)) {
    const count = usedSlugs.get(baseSlug)! + 1;
    usedSlugs.set(baseSlug, count);
    return `${baseSlug}-${count}`;
  }

  usedSlugs.set(baseSlug, 0);
  return baseSlug;
}

export function extractToc(markdown: string): TocEntry[] {
  const lines = markdown.split('\n');
  const usedSlugs = new Map<string, number>();
  const entries: TocEntry[] = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = line.match(/^(#{1,3})\s+(.+)/);
    if (!m) continue;

    const level = m[1].length as 1 | 2 | 3;
    const text = normalizeHeadingText(m[2]);
    if (!text) continue;

    entries.push({
      level,
      text,
      id: slugify(text, usedSlugs),
    });
  }

  return entries;
}

/** First TOC id per level+text; later duplicates keep the first occurrence. */
export function buildHeadingIdLookup(toc: TocEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of toc) {
    const key = `${entry.level}:${entry.text}`;
    if (!map.has(key)) map.set(key, entry.id);
  }
  return map;
}

export function headingLookupKey(level: 1 | 2 | 3, text: string): string {
  return `${level}:${normalizeHeadingText(text)}`;
}
