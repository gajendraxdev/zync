/**
 * Terminal display-cell width helpers (xterm / classic wcwidth subset).
 * Used for ghost lag layout and overlay glyph spans so wide CJK/emoji and
 * combining marks align with the terminal grid.
 */

/** Zero-width / non-spacing mark ranges commonly treated as width 0 in terminals. */
function isZeroWidthCodePoint(cp: number): boolean {
  if (cp === 0) return true;
  // C0 / DEL / C1 controls (not typically in typed line buffer, but safe)
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return true;
  // Combining Diacritical Marks and related
  if (cp >= 0x0300 && cp <= 0x036f) return true;
  if (cp >= 0x0483 && cp <= 0x0489) return true;
  if (cp >= 0x0591 && cp <= 0x05bd) return true;
  if (cp === 0x05bf || cp === 0x05c1 || cp === 0x05c2 || cp === 0x05c4 || cp === 0x05c5 || cp === 0x05c7) {
    return true;
  }
  if (cp >= 0x0610 && cp <= 0x061a) return true;
  if (cp >= 0x064b && cp <= 0x065f) return true;
  if (cp === 0x0670) return true;
  if (cp >= 0x06d6 && cp <= 0x06ed) return true;
  if (cp >= 0x20d0 && cp <= 0x20f0) return true;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true; // variation selectors
  if (cp >= 0xfe20 && cp <= 0xfe2f) return true;
  if (cp >= 0x1ab0 && cp <= 0x1aff) return true;
  if (cp >= 0x1dc0 && cp <= 0x1dff) return true;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true; // variation selectors supplement
  // Zero-width joiner / non-joiner
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff) return true;
  return false;
}

/**
 * East-Asian wide / fullwidth and common emoji ranges (width 2 in most terminals).
 * Intentionally a practical subset, not a full Unicode EastAsianWidth database.
 */
function isWideCodePoint(cp: number): boolean {
  if (cp >= 0x1100 && cp <= 0x115f) return true;
  if (cp === 0x2329 || cp === 0x232a) return true;
  if (cp >= 0x2e80 && cp <= 0xa4cf) return true;
  if (cp >= 0xac00 && cp <= 0xd7a3) return true;
  if (cp >= 0xf900 && cp <= 0xfaff) return true;
  if (cp >= 0xfe10 && cp <= 0xfe19) return true;
  if (cp >= 0xfe30 && cp <= 0xfe6f) return true;
  if (cp >= 0xff00 && cp <= 0xff60) return true;
  if (cp >= 0xffe0 && cp <= 0xffe6) return true;
  if (cp >= 0x1f300 && cp <= 0x1f9ff) return true; // emoji blocks
  if (cp >= 0x1f000 && cp <= 0x1f02f) return true;
  if (cp >= 0x1f0a0 && cp <= 0x1f0ff) return true;
  if (cp >= 0x20000 && cp <= 0x3fffd) return true; // CJK ext
  return false;
}

/** Fitzpatrick skin-tone modifiers. */
function isEmojiSkinTone(cp: number): boolean {
  return cp >= 0x1f3fb && cp <= 0x1f3ff;
}

/** Display cells for a single Unicode code point (0, 1, or 2). */
export function codePointDisplayWidth(cp: number): number {
  if (isZeroWidthCodePoint(cp)) return 0;
  if (isWideCodePoint(cp)) return 2;
  return 1;
}

/**
 * Terminal width of one grapheme cluster.
 * - Combining marks on a base letter → width of base (usually 1).
 * - ZWJ / skin-tone emoji sequences → 2 (do not sum component widths).
 */
export function graphemeDisplayWidth(grapheme: string): number {
  if (!grapheme) return 0;

  let sum = 0;
  let max = 0;
  let hasWide = false;
  let hasNonZero = false;
  let hasZwj = false;
  let hasSkinTone = false;
  let codePointCount = 0;

  for (const ch of grapheme) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    codePointCount += 1;
    if (cp === 0x200d) hasZwj = true;
    if (isEmojiSkinTone(cp)) hasSkinTone = true;
    const w = codePointDisplayWidth(cp);
    sum += w;
    if (w > max) max = w;
    if (w === 2) hasWide = true;
    if (w > 0) hasNonZero = true;
  }

  if (!hasNonZero) return 0;

  // Multi-codepoint emoji presentation: terminals typically reserve 2 cells.
  if (codePointCount > 1 && (hasWide || hasZwj || hasSkinTone)) {
    return Math.max(max, 2);
  }

  return sum;
}

/** Total terminal cells for a string (grapheme-aware when Segmenter is available). */
export function stringDisplayWidth(text: string): number {
  if (!text) return 0;
  const clusters = splitGraphemeClusters(text);
  let width = 0;
  for (const cluster of clusters) {
    width += graphemeDisplayWidth(cluster);
  }
  return width;
}

export interface TerminalCellSegment {
  /** Grapheme (or merged code-point) text. */
  text: string;
  /** Columns this segment occupies on the terminal grid. */
  cells: number;
}

export interface SegmentTerminalCellsOptions {
  /** Force code-point split (tests the no-Intl.Segmenter fallback). */
  forceCodePointSplit?: boolean;
}

function splitGraphemeClusters(text: string, forceCodePointSplit = false): string[] {
  const segments: string[] = [];
  if (!forceCodePointSplit) {
    const IntlWithSegmenter = Intl as typeof Intl & {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
      ) => {
        segment: (input: string) => Iterable<{ segment: string }>;
      };
    };
    if (typeof Intl !== 'undefined' && typeof IntlWithSegmenter.Segmenter === 'function') {
      try {
        const segmenter = new IntlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' });
        for (const { segment } of segmenter.segment(text)) {
          if (segment) segments.push(segment);
        }
      } catch {
        // fall through
      }
    }
  }
  if (segments.length === 0) {
    for (const ch of text) {
      segments.push(ch);
    }
  }
  return segments;
}

/**
 * Build overlay segments: merge zero-width code points into the previous base
 * glyph so combining marks are never rendered in a width-0 overflow-hidden span.
 */
function buildCellSegments(rawSegments: string[]): TerminalCellSegment[] {
  const out: TerminalCellSegment[] = [];
  for (const segment of rawSegments) {
    if (!segment) continue;
    const cells = graphemeDisplayWidth(segment);
    if (cells === 0) {
      if (out.length > 0) {
        out[out.length - 1].text += segment;
      }
      // Leading-only ZW with no base: drop (invisible).
      continue;
    }
    out.push({ text: segment, cells });
  }
  return out;
}

/**
 * Split text into terminal cells for overlay rendering.
 * Prefers Intl.Segmenter grapheme clusters when available.
 */
export function segmentTerminalCells(
  text: string,
  options?: SegmentTerminalCellsOptions,
): TerminalCellSegment[] {
  if (!text) return [];
  const raw = splitGraphemeClusters(text, options?.forceCodePointSplit === true);
  return buildCellSegments(raw);
}
