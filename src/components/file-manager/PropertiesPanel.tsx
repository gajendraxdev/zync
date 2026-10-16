import { Folder, Info, X } from 'lucide-react';
import { FileEntryIcon } from './FileEntryIcon';
import { cn, formatBytes } from '../../lib/utils';
import { isMatch } from '../../lib/keyboard';
import { formatFileListDate, formatFileListType } from './fileGridLayout';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import type { ReactNode } from 'react';
import type { FileEntry } from './types';

interface PropertiesPanelProps {
  files: FileEntry[];
  onClose: () => void;
  dateTimeFormat?: 'simple' | 'detailed';
  showHeader?: boolean;
}

function fileKindLabel(file: FileEntry): string {
  if (file.type === 'd') return 'Folder';
  return formatFileListType(file);
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
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 py-1 text-xs">
      <dt className="text-app-muted">
        {label}
      </dt>
      <dd className={cn('min-w-0 [overflow-wrap:anywhere] text-app-text select-text', mono && 'font-mono')}>
        {value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border-t border-app-border/30 py-3">
    <h3 className="mb-1 text-xs font-medium text-app-text">{title}</h3>
    <dl>{children}</dl>
  </section>;
}

export function PropertiesPanel({ files, onClose, dateTimeFormat = 'simple', showHeader = true }: PropertiesPanelProps) {
  const single = files.length === 1 ? files[0] : null;
  const folderCount = files.filter((file) => file.type === 'd').length;
  const otherCount = files.length - folderCount;
  const totalSize = files.reduce((sum, file) => sum + (file.type === 'd' ? 0 : file.size), 0);

  return (
    <aside aria-label="File properties" className={cn('flex h-full w-full min-w-0 flex-col bg-app-panel/70', !showHeader && 'max-h-[70vh]')}
      onKeyDown={event => {
        // Inline details own dismissal, including Escape already used to hide a button's tooltip.
        // The shared dialog remains the sole dismissal owner for modal details.
        if (!showHeader || event.nativeEvent.isComposing || !isMatch(event.nativeEvent, 'Escape')) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}>
      {showHeader && <header className="flex shrink-0 items-center justify-between gap-1 border-b border-app-border/30 px-3 py-1.5">
        <h2 className="truncate text-sm font-medium text-app-text">
          {files.length > 1 ? `${files.length} items` : 'Properties'}
        </h2>
        <Tooltip content="Close properties" position="bottom">
          <IconButton label="Close properties" icon={<X size={14} />} onClick={onClose} data-file-inspector-close="" />
        </Tooltip>
      </header>}

      {files.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-10 text-center">
          <Info size={20} className="mb-2 text-app-muted" />
          <span className="text-sm text-app-muted">Select a file or folder</span>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <div className="flex items-center gap-3 py-4">
            <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center">
              {single ? <FileEntryIcon file={single} size={32} />
                : <Folder size={32} fill="currentColor" className="text-app-accent" strokeWidth={0.5} />}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="[overflow-wrap:anywhere] text-sm font-medium text-app-text select-text">
                {single ? single.name : `${files.length} items`}
              </h3>
              <div className="mt-1 text-xs text-app-muted">
                {single
                  ? fileKindLabel(single)
                  : [folderCount ? `${folderCount} folder${folderCount === 1 ? '' : 's'}` : null, otherCount ? `${otherCount} file${otherCount === 1 ? '' : 's'}` : null]
                      .filter(Boolean)
                      .join(' · ')}
              </div>
            </div>
          </div>

            {single ? (
              <>
                <Section title="Location">
                  <dt className="sr-only">Path</dt>
                  <dd className="py-1.5 text-xs text-app-text select-text [overflow-wrap:anywhere]">{single.path || '—'}</dd>
                </Section>
                <Section title="Information">
                  <Row label="Size" value={single.type === 'd' ? '—' : formatBytes(single.size)} />
                  <Row label="Type" value={fileKindLabel(single)} />
                  <Row label="Modified" value={formatFileListDate(single.lastModified, Date.now(), dateTimeFormat) || '—'} />
                </Section>
                <Section title="Permissions">
                  <Row label="Owner" value={(single.owner || '').trim() || '—'} />
                  <Row label="Group" value={(single.group || '').trim() || '—'} />
                  <Row label="Mode" value={unixModeString(single.permissions || '')} mono />
                  <Row label="Octal" value={single.permissions?.trim() || '—'} mono />
                </Section>
                <p className="pb-4 text-xs leading-relaxed text-app-muted">Reported metadata only. Effective access may also depend on ACLs and server policy.</p>
              </>
            ) : (
              <Section title="Selection">
                <Row label="Items" value={String(files.length)} />
                <Row label="Size" value={formatBytes(totalSize)} />
                <Row label="Folders" value={String(folderCount)} />
                <Row label="Files" value={String(otherCount)} />
              </Section>
            )}
        </div>
      )}
    </aside>
  );
}
