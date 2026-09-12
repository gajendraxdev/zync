import { Folder, Info, X } from 'lucide-react';
import { DynamicIcon } from '../ui/DynamicIcon';
import { cn, formatBytes } from '../../lib/utils';
import { formatFileListDate } from './fileGridLayout';
import type { FileEntry } from './types';

interface PropertiesPanelProps {
  files: FileEntry[];
  onClose: () => void;
  dateTimeFormat?: 'simple' | 'detailed';
}

function fileKindLabel(file: FileEntry): string {
  if (file.type === 'd') return 'Folder';
  if (file.type === 'l') return 'Link';
  const name = file.name;
  if (name.startsWith('.') && name.indexOf('.', 1) === -1) return 'File';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (!ext || ext === name) return 'File';
  return `${ext.toUpperCase()} file`;
}

function unixModeString(octal: string): string {
  const digits = octal.trim();
  if (!/^[0-7]{3,4}$/.test(digits)) return digits || '—';
  const padded = digits.padStart(4, '0');
  const special = parseInt(padded[0], 8);
  const three = padded.slice(-3);
  const execChar = (hasExec: boolean, specialBit: number, marked: 's' | 't') => {
    if (special & specialBit) return hasExec ? marked : marked.toUpperCase();
    return hasExec ? 'x' : '-';
  };
  const bit = (n: number, specialBit: number, marked: 's' | 't') => (
    `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${execChar(Boolean(n & 1), specialBit, marked)}`
  );
  return [
    bit(parseInt(three[0], 8), 4, 's'),
    bit(parseInt(three[1], 8), 2, 's'),
    bit(parseInt(three[2], 8), 1, 't'),
  ].join('');
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5">
      <dt className="w-[4.75rem] shrink-0 text-[10px] font-medium uppercase tracking-wider text-app-muted/70">
        {label}
      </dt>
      <dd className={cn('min-w-0 flex-1 break-all text-[12px] font-medium text-app-text select-text', mono && 'font-mono tracking-wide')}>
        {value}
      </dd>
    </div>
  );
}

export function PropertiesPanel({ files, onClose, dateTimeFormat = 'simple' }: PropertiesPanelProps) {
  const single = files.length === 1 ? files[0] : null;
  const folderCount = files.filter((file) => file.type === 'd').length;
  const otherCount = files.length - folderCount;
  const totalSize = files.reduce((sum, file) => sum + (file.type === 'd' ? 0 : file.size), 0);

  return (
    <aside className="flex h-full w-full min-w-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-1 border-b border-app-border/30 px-2 py-1.5">
        <h2 className="truncate px-1 text-[11px] font-medium text-app-text">
          {files.length > 1 ? `${files.length} items` : 'Properties'}
        </h2>
        <button
          type="button"
          aria-label="Close properties"
          className="shrink-0 rounded-md p-1 text-app-muted transition-all hover:bg-app-surface/50 hover:text-app-text"
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </header>

      {files.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-10 text-center opacity-60">
          <Info size={20} className="mb-2 text-app-muted" />
          <span className="text-[10px] font-medium text-app-muted">Select a file or folder</span>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="mb-1 flex flex-col items-center px-1 py-3 text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center">
              {single && single.type !== 'd' ? (
                <DynamicIcon type={single.name} size={32} />
              ) : (
                <Folder size={32} fill="currentColor" className="text-app-accent" strokeWidth={0.5} />
              )}
            </div>
            <div className="w-full break-all text-[12px] font-medium text-app-text select-text">
              {single ? single.name : `${files.length} items`}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-app-muted/70">
              {single
                ? fileKindLabel(single)
                : [folderCount ? `${folderCount} folder${folderCount === 1 ? '' : 's'}` : null, otherCount ? `${otherCount} file${otherCount === 1 ? '' : 's'}` : null]
                    .filter(Boolean)
                    .join(' · ')}
            </div>
          </div>

          <dl>
            {single ? (
              <>
                <Row label="Location" value={single.path || '—'} />
                <Row label="Size" value={single.type === 'd' ? '—' : formatBytes(single.size)} />
                <Row label="Type" value={fileKindLabel(single)} />
                <Row label="Owner" value={(single.owner || '').trim() || '—'} />
                <Row label="Group" value={(single.group || '').trim() || '—'} />
                <Row label="Modified" value={formatFileListDate(single.lastModified, Date.now(), dateTimeFormat) || '—'} />
                <Row label="Mode" value={unixModeString(single.permissions || '')} mono />
                <Row label="Octal" value={single.permissions?.trim() || '—'} mono />
              </>
            ) : (
              <>
                <Row label="Items" value={String(files.length)} />
                <Row label="Size" value={formatBytes(totalSize)} />
                <Row label="Folders" value={String(folderCount)} />
                <Row label="Files" value={String(otherCount)} />
              </>
            )}
          </dl>
        </div>
      )}
    </aside>
  );
}
