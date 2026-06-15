import { useAppStore } from '../../store/useAppStore';

export function VaultSyncHandoffStrip() {
    const openSyncBackupTab = useAppStore(state => state.openSyncBackupTab);

    return (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-app-border/50 bg-app-surface/20 px-3 py-2">
            <p className="text-[11px] leading-relaxed text-app-muted">
                Provider sync is separate from this local vault. Hosts, tunnels, and bulk credential sync live in{' '}
                <span className="text-app-text/90">Sync & Backup</span>.
            </p>
            <button
                type="button"
                onClick={openSyncBackupTab}
                className="shrink-0 text-[11px] font-medium text-app-accent underline-offset-2 hover:underline"
            >
                Open Sync & Backup →
            </button>
        </div>
    );
}