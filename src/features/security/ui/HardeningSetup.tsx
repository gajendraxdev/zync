import { ChevronRight, Play, ShieldCheck, Square, Unplug } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Switch } from '../../../components/ui/Switch';
import { cn } from '../../../lib/utils';

interface HardeningSetupProps {
    connected: boolean;
    local: boolean;
    compact: boolean;
    busy: boolean;
    stopping: boolean;
    elevationConsent: boolean;
    onElevationChange(value: boolean): void;
    onRun(): void;
    onCancel(): void;
}

const BASELINE_CHECK_COUNT = 38;

/** Keep scope and access qualifications available without making the idle screen a documentation page. */
function ScopeDetails({ compact }: { compact: boolean }) {
    return <details data-assessment-setup-scope className="group/setup-scope mt-4 text-xs">
        <summary className={cn('flex w-fit cursor-pointer list-none items-center gap-1.5 rounded py-1 text-app-muted hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus [&::-webkit-details-marker]:hidden', !compact && 'mx-auto')}>
            <ChevronRight size={13} aria-hidden="true" className="transition-transform group-open/setup-scope:rotate-90 motion-reduce:transition-none" />Scope &amp; access
        </summary>
        <div className="mt-3 space-y-3 rounded-lg border border-app-border bg-app-panel p-4 text-left leading-relaxed text-app-muted">
            <p>{BASELINE_CHECK_COUNT} checks cover selected Linux, account, SSH, network, mount, update and service settings. Requires a Linux SSH host with GNU coreutils timeout.</p>
            <p>Checks run only when you approve them. They read settings without making changes, installing an agent or contacting an external service. This is not a full security or compliance audit.</p>
            <p>Uses your SSH account’s permissions. Sudo is optional and allowed for this run only. If needed, its password stays in memory—not saved, synced or logged. Server policy still applies; some information may remain unreadable.</p>
        </div>
    </details>;
}

/** One controlled setup surface: focused empty state before a run, compact controls alongside results. */
export function HardeningSetup({ connected, local, compact, busy, stopping, elevationConsent, onElevationChange, onRun, onCancel }: HardeningSetupProps) {
    const title = local ? 'Choose an SSH host' : !connected ? 'Connect to get started' : 'Host hardening';
    const description = local ? 'Hardening is available for Linux SSH hosts.'
        : !connected ? 'Connect this SSH host to run a hardening review.'
            : 'Review your Linux configuration without changing it.';
    const Icon = connected ? ShieldCheck : Unplug;

    return <section aria-label="Assessment setup" className={cn(compact ? 'py-5' : 'mx-auto w-full max-w-md py-10 sm:py-16')}>
        <div className={cn(compact ? 'flex flex-wrap items-center justify-between gap-4' : 'text-center')}>
            <div className="min-w-0">
                {!compact && <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-app-border bg-app-panel text-app-accent">
                    <Icon size={27} strokeWidth={1.5} aria-hidden="true" />
                </div>}
                <h2 className={cn('font-semibold tracking-tight', compact ? 'text-sm' : 'text-xl')}>{title}</h2>
                <p role={!connected ? 'status' : undefined} className={cn('text-xs leading-relaxed text-app-muted', compact ? 'mt-1' : 'mt-2')}>{description}</p>
                {!compact && <p className="mt-3 text-[11px] text-app-muted">{BASELINE_CHECK_COUNT} security checks</p>}
            </div>

            <div className={cn(compact ? 'flex flex-wrap items-center gap-3' : 'mt-6 flex flex-col gap-3')}>
                {connected && <Switch label="Use sudo" checked={elevationConsent} onCheckedChange={onElevationChange}
                    disabled={busy} showLabel description={compact ? undefined : 'Read protected information · this run only'}
                    className={cn('border border-app-border bg-app-panel', compact ? 'w-auto gap-4 px-3 py-1.5' : 'w-full')} />}
                {busy ? <Button variant="secondary" size="sm" onClick={onCancel} disabled={stopping}>
                    <Square size={12} className="mr-2" aria-hidden="true" />{stopping ? 'Stopping…' : 'Cancel assessment'}
                </Button> : <Button size="sm" disabled={!connected} onClick={onRun} className={compact ? undefined : 'w-full'}>
                    <Play size={13} className="mr-2" aria-hidden="true" />Run assessment
                </Button>}
            </div>
        </div>
        <ScopeDetails compact={compact} />
    </section>;
}
