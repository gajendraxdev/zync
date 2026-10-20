import type { FileEntry } from './types';
import { formatBytes } from '../../lib/utils';

export interface FileSelectionSummary {
  count: number;
  files: number;
  folders: number;
  links: number;
  bytes: number;
  unknownSizes: number;
}

/** Project listing metadata only. Folder contents belong to single-folder Properties. */
export function fileSelectionSummary(entries: readonly FileEntry[], selectedNames: readonly string[]): FileSelectionSummary {
  const summary: FileSelectionSummary = { count: 0, files: 0, folders: 0, links: 0, bytes: 0, unknownSizes: 0 };
  if (!selectedNames.length) return summary;
  const selected = new Set(selectedNames);
  for (const entry of entries) {
    if (!selected.delete(entry.name)) continue;
    summary.count += 1;
    if (entry.type === 'l') { summary.links += 1; continue; }
    let bytes: number | undefined;
    if (entry.type === 'd') {
      summary.folders += 1;
    } else { summary.files += 1; bytes = entry.size; }
    if (bytes !== undefined && Number.isSafeInteger(bytes) && bytes >= 0 && Number.isSafeInteger(summary.bytes + bytes)) {
      summary.bytes += bytes;
    } else {
      summary.unknownSizes += 1;
    }
  }
  return summary;
}

/** The same metadata-only total is used by the selection bar and multi-item Properties. */
export function fileSelectionSizeLabel(summary: FileSelectionSummary): string {
  const measured = summary.files + summary.folders - summary.unknownSizes;
  if (!measured) return '';
  const incomplete = summary.unknownSizes > 0;
  return `${incomplete ? 'Partial · ' : ''}${formatBytes(summary.bytes)}`;
}
