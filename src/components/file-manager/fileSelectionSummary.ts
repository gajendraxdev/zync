import type { FileEntry } from './types';

export interface FileSelectionSummary {
  count: number;
  files: number;
  folders: number;
  links: number;
  bytes: number;
  unknownSizes: number;
}

/** Use only regular-file metadata already loaded in this pane; never scan folders or follow links. */
export function fileSelectionSummary(entries: readonly FileEntry[], selectedNames: readonly string[]): FileSelectionSummary {
  const summary: FileSelectionSummary = { count: 0, files: 0, folders: 0, links: 0, bytes: 0, unknownSizes: 0 };
  if (!selectedNames.length) return summary;
  const selected = new Set(selectedNames);
  for (const entry of entries) {
    if (!selected.delete(entry.name)) continue;
    summary.count += 1;
    if (entry.type === 'd') summary.folders += 1;
    else if (entry.type === 'l') summary.links += 1;
    else {
      summary.files += 1;
      if (Number.isFinite(entry.size) && entry.size >= 0 && Number.isSafeInteger(summary.bytes + entry.size)) summary.bytes += entry.size;
      else summary.unknownSizes += 1;
    }
  }
  return summary;
}
