import type { FileEntry } from './types';
import type { FolderSizeState } from '../../features/files/domain/folderSizes';
import { formatBytes } from '../../lib/utils';

export interface FileSelectionSummary {
  count: number;
  files: number;
  folders: number;
  links: number;
  bytes: number;
  unknownSizes: number;
  partialSizes: number;
  pendingSizes: number;
}

/** Project existing metadata/results only. Never trigger scans or count link targets. */
export function fileSelectionSummary(entries: readonly FileEntry[], selectedNames: readonly string[],
  folders: Readonly<Record<string, FolderSizeState>> = {}): FileSelectionSummary {
  const summary: FileSelectionSummary = { count: 0, files: 0, folders: 0, links: 0, bytes: 0, unknownSizes: 0, partialSizes: 0, pendingSizes: 0 };
  if (!selectedNames.length) return summary;
  const selected = new Set(selectedNames);
  for (const entry of entries) {
    if (!selected.delete(entry.name)) continue;
    summary.count += 1;
    if (entry.type === 'l') { summary.links += 1; continue; }
    let bytes: number | undefined;
    if (entry.type === 'd') {
      summary.folders += 1;
      const state = folders[entry.path];
      if (state?.status === 'finished') {
        bytes = Number(state.report.bytes);
        if (!state.report.complete) summary.partialSizes += 1;
      } else if (state?.status === 'queued' || state?.status === 'calculating') summary.pendingSizes += 1;
    } else { summary.files += 1; bytes = entry.size; }
    if (bytes !== undefined && Number.isSafeInteger(bytes) && bytes >= 0 && Number.isSafeInteger(summary.bytes + bytes)) {
      summary.bytes += bytes;
    } else {
      summary.unknownSizes += 1;
    }
  }
  return summary;
}

/** The same honest total is used by the selection bar and multi-item Properties. */
export function fileSelectionSizeLabel(summary: FileSelectionSummary): string {
  const measured = summary.files + summary.folders - summary.unknownSizes;
  if (!measured) return summary.pendingSizes ? '—' : summary.files + summary.folders ? 'Size unavailable' : '';
  const incomplete = summary.unknownSizes > 0 || summary.partialSizes > 0;
  return `${incomplete ? 'Partial · ' : ''}${formatBytes(summary.bytes)}`;
}
