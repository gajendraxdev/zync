import type { ReactNode } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { TopbarDropdown } from '../../../components/ui/TopbarDropdown';
import type { ReportExportFormat } from '../domain/savedReports';

/** Share report export/action disclosures with keyboard dismissal and opener focus restoration. */
export function ReportActionMenu({ label, children }: { label: ReactNode; children: ReactNode }) {
    return <details className="relative" onKeyDown={event => {
        if (event.key === 'Escape' && event.currentTarget.open) {
            event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
            event.currentTarget.querySelector('summary')?.focus();
        }
    }}>
        <summary className="flex h-[var(--zync-control-height-sm)] cursor-pointer list-none items-center gap-2 rounded px-3 text-xs text-app-muted hover:bg-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus [&::-webkit-details-marker]:hidden">{label}</summary>
        <TopbarDropdown align="right"><div onClick={event => {
            if ((event.target as HTMLElement).closest('button:not(:disabled)')) {
                const menu = event.currentTarget.closest('details'); menu?.removeAttribute('open'); menu?.querySelector('summary')?.focus();
            }
        }}>{children}</div></TopbarDropdown>
    </details>;
}

/** Keep export formats and labels consistent between saved rows and open report details. */
export function ReportExportMenu({ label, disabled, onExport }: { label?: ReactNode; disabled: boolean; onExport(format: ReportExportFormat): void }) {
    return <ReportActionMenu label={label ?? <><Download size={13} aria-hidden="true" />Export<ChevronDown size={11} aria-hidden="true" /></>}>
        {(['json', 'csv', 'xlsx'] as const).map(format => <Button key={format} variant="ghost" size="sm" className="w-full justify-start" disabled={disabled} onClick={() => onExport(format)}>Export {format === 'xlsx' ? 'Excel (.xlsx)' : format.toUpperCase()}</Button>)}
    </ReportActionMenu>;
}
