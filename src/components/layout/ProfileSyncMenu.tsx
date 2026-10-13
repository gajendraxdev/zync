import { useState, useEffect, useRef, useId, useSyncExternalStore } from 'react';
import { Settings as SettingsIcon, Shield, UserRound, ChevronDown, RefreshCw, Network, LogOut, Link2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../lib/utils';
import { GoogleMarkIcon } from '../icons/providerIcons';
import { Tooltip } from '../ui/Tooltip';
import { TopbarDropdown } from '../ui/TopbarDropdown';
import { isInsideMenu } from '../ui/MenuSubmenu';
import { TerminalShortcutControl } from '../settings/common/TerminalShortcutControl';
import { useModalStore } from '../../lib/modalRegistry';
import '../settings/KeyboardShortcutsModal';
import { syncIpc, SYNC_STATUS_CHANGED_EVENT, type SyncProviderStatus } from '../../vault/syncIpc';
import { useShareStore } from '../../features/share/useShareStore';
import { parseShareError } from '../../features/share/ipc';
import { PublicUrlsLabel } from '../share/PublicUrlsLabel';
import { shortcutHint } from '../../features/shortcuts/labels';
import { resolveWorkspaceNavigation } from '../../features/workspace/domain/navigation';

function googleConnectErrorMessage(error: unknown): string {
    const raw = (error instanceof Error ? error.message : String(error ?? 'Unknown error')).trim();
    const normalized = raw.toLowerCase();

    if (normalized.includes('access_denied') || normalized.includes('oauth denied') || normalized.includes('user denied')) {
        return 'Google sign-in was cancelled or access was denied. Retry and approve Drive access on the Google consent screen.';
    }
    if (normalized.includes('popup') && normalized.includes('block')) {
        return 'Google sign-in did not open. Allow the browser window or popup, then retry Connect Google Sync.';
    }
    if (normalized.includes('timed out') || normalized.includes('timeout')) {
        return 'Google sign-in timed out. Check your network and retry Connect Google Sync.';
    }
    if (normalized.includes('network') || normalized.includes('dns') || normalized.includes('connection refused')) {
        return 'Google sync could not reach the network. Check connectivity, proxy, or firewall settings and retry.';
    }

    return raw;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        }),
    ]).finally(() => clearTimeout(timer));
}

// A chrome relocation may remount this control; it must not permit a second OAuth operation.
const googleSyncOperationRef = { current: null as Promise<unknown> | null };
let syncOperationMode: 'connect' | 'disconnect' | null = null;
const operationListeners = new Set<() => void>();
const subscribeOperation = (listener: () => void) => { operationListeners.add(listener); return () => { operationListeners.delete(listener); }; };
const setOperation = (mode: typeof syncOperationMode) => { syncOperationMode = mode; operationListeners.forEach(listener => listener()); };
const setIsGoogleSyncConnecting = (value: boolean) => setOperation(value ? 'connect' : null);
const setIsGoogleSyncDisconnecting = (value: boolean) => setOperation(value ? 'disconnect' : null);


/** Shared profile surface. Placement never combines Drive Sync and Public URLs identities. */
export function ProfileSyncMenu({ compact = false }: { compact?: boolean }) {
    const openSettings = useAppStore(state => state.openSettings);
    const openVaultTab = useAppStore(state => state.openVaultTab);
    const openSyncBackupTab = useAppStore(state => state.openSyncBackupTab);
    const openPublicUrlsTab = useAppStore(state => state.openPublicUrlsTab);
    const showToast = useAppStore(state => state.showToast);
    const keybindings = useAppStore(state => state.settings.keybindings);
    const navigation = useAppStore(state => state.settings.workspaceNavigation);
    const shareAuth = useShareStore(state => state.auth);
    const shareBusy = useShareStore(state => state.busy);
    const shareHydrate = useShareStore(state => state.hydrate);
    const shareLogout = useShareStore(state => state.logout);
    const buttonId = useId();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const profileMenuRef = useRef<HTMLDivElement>(null);
    const [googleSync, setGoogleSync] = useState<SyncProviderStatus | null>(null);
    const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
    const operation = useSyncExternalStore(subscribeOperation, () => syncOperationMode, () => null);
    const isGoogleSyncConnecting = operation === 'connect';
    const isGoogleSyncDisconnecting = operation === 'disconnect';

    useEffect(() => {
        const open = () => {
            buttonRef.current?.focus({ preventScroll: true });
            setIsProfileMenuOpen(true);
        };
        window.addEventListener('zync:open-profile-menu', open);
        return () => window.removeEventListener('zync:open-profile-menu', open);
    }, []);

    useEffect(() => {
        if (!isProfileMenuOpen) return;
        const outside = (event: MouseEvent) => {
            if (!isInsideMenu(profileMenuRef.current, event.target)) setIsProfileMenuOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            setIsProfileMenuOpen(false);
            buttonRef.current?.focus();
        };
        document.addEventListener('mousedown', outside);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('mousedown', outside);
            document.removeEventListener('keydown', escape);
        };
    }, [isProfileMenuOpen]);
    useEffect(() => {
        let active = true;
        const refreshGoogleSync = () => {
            syncIpc.status('google')
                .then(value => { if (active) setGoogleSync(value); })
                .catch(() => { if (active) setGoogleSync(null); });
        };

        refreshGoogleSync();
        void shareHydrate();
        const onSyncStatusChanged = (event: Event) => {
            const detail = (event as CustomEvent<{ provider?: string }>).detail;
            if (!detail?.provider || detail.provider === 'google') {
                refreshGoogleSync();
            }
        };
        window.addEventListener(SYNC_STATUS_CHANGED_EVENT, onSyncStatusChanged);
        return () => { active = false; window.removeEventListener(SYNC_STATUS_CHANGED_EVENT, onSyncStatusChanged); };
    }, [shareHydrate]);


    const zyncEmail = shareAuth.signed_in && typeof shareAuth.email === 'string'
        ? shareAuth.email
        : undefined;
    const zyncAvatarUrl = shareAuth.signed_in && typeof shareAuth.avatar_url === 'string'
        ? shareAuth.avatar_url
        : undefined;
    const profileAvatarUrl = zyncAvatarUrl || googleSync?.avatarUrl || null;
    const profileInitial = (
        zyncEmail?.trim().charAt(0)
        || googleSync?.email?.trim().charAt(0)
        || 'U'
    ).toUpperCase();

    useEffect(() => {
        setAvatarLoadFailed(false);
    }, [profileAvatarUrl]);


    return (<div className="relative" ref={profileMenuRef}>
        <Tooltip content={`Profile & Sync (${shortcutHint('navigationProfile', keybindings)})`}
            position={compact ? resolveWorkspaceNavigation(navigation).position === 'right' ? 'left' : 'right' : 'bottom'} disabled={isProfileMenuOpen}>
            <button
                id={buttonId} ref={buttonRef} type="button" aria-haspopup="dialog" aria-expanded={isProfileMenuOpen}
                onClick={() => setIsProfileMenuOpen(open => !open)}
                className={cn(
                    "h-7 px-2 shrink-0 rounded-md text-app-muted hover:text-app-text hover:bg-app-surface border border-transparent hover:border-app-border/40 transition-colors drag-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/60 focus-visible:ring-offset-0 flex items-center justify-center gap-1.5",
                    isProfileMenuOpen && "bg-app-surface text-app-text border-app-border/40",
                    compact && "w-8 h-8 px-0"
                )}
                aria-label="Profile and sync menu"
            >
                <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-app-accent/20 border border-app-accent/40 text-[10px] font-bold text-app-text overflow-hidden shadow-sm">
                    {profileAvatarUrl && !avatarLoadFailed ? (
                        <img
                            src={profileAvatarUrl}
                            alt="Profile"
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={() => setAvatarLoadFailed(true)}
                        />
                    ) : zyncEmail || googleSync?.email ? (
                        profileInitial
                    ) : (
                        <UserRound size={10} />
                    )}
                </span>
                {!compact && <ChevronDown size={12} />}
            </button>
        </Tooltip>

        {isProfileMenuOpen && (
            <TopbarDropdown anchor={buttonRef.current} align="right" widthClass="w-64">
                <button
                    onClick={() => {
                        openSettings();
                        setIsProfileMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-app-text hover:bg-black/5 dark:hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors"
                >
                    <SettingsIcon size={13} className="text-app-muted" />
                    <span>Settings</span>
                </button>
                <TerminalShortcutControl menu onManage={() => {
                    setIsProfileMenuOpen(false);
                    // Restore to a durable opener, not the menu item being removed.
                    buttonRef.current?.focus();
                    useModalStore.getState().open('keyboardShortcuts');
                }} />
                <button
                    onClick={() => {
                        openVaultTab('local');
                        setIsProfileMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-app-text hover:bg-black/5 dark:hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors"
                >
                    <Shield size={13} className="text-app-muted" />
                    <span>Vault Credentials</span>
                </button>
                <div className="h-px bg-app-border/40 my-1 mx-1" />
                <button
                    onClick={() => {
                        openSyncBackupTab();
                        setIsProfileMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-app-text hover:bg-black/5 dark:hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors"
                >
                    <GoogleMarkIcon size={13} variant="mono" className="text-app-muted shrink-0" />
                    <span className="min-w-0">
                        <span className="block">Sync & Backup</span>
                        <span className="block text-[10px] font-normal text-app-muted truncate">
                            {googleSync?.email || 'Google Drive'}
                        </span>
                    </span>
                </button>
                {!googleSync?.connected && (
                    <button
                        onClick={async () => {
                            if (googleSyncOperationRef.current) return;
                            setIsGoogleSyncConnecting(true);
                            const originalPromise = syncIpc.connect('google');
                            googleSyncOperationRef.current = originalPromise;
                            void originalPromise
                                .catch(error => console.warn('[Sync] Google connect completed with an error:', error))
                                .finally(() => {
                                    if (googleSyncOperationRef.current === originalPromise) {
                                        googleSyncOperationRef.current = null;
                                        setIsGoogleSyncConnecting(false);
                                    }
                                });
                            try {
                                await withTimeout(
                                    originalPromise,
                                    30000,
                                    'Google sync connection timed out'
                                );
                                showToast('success', 'Google sync connected');
                            } catch (error) {
                                showToast('error', googleConnectErrorMessage(error));
                            } finally {
                                setIsProfileMenuOpen(false);
                            }
                        }}
                        disabled={isGoogleSyncConnecting}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-app-text hover:bg-black/5 dark:hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-60"
                    >
                        {isGoogleSyncConnecting ? (
                            <RefreshCw size={13} className="text-app-muted animate-spin" />
                        ) : (
                            <Network size={13} className="text-app-muted" />
                        )}
                        <span>{isGoogleSyncConnecting ? 'Connecting…' : 'Connect Google Drive'}</span>
                    </button>
                )}
                {googleSync?.connected && (
                    <button
                        onClick={async () => {
                            if (googleSyncOperationRef.current) return;
                            setIsGoogleSyncDisconnecting(true);
                            const originalPromise = syncIpc.disconnect('google');
                            googleSyncOperationRef.current = originalPromise;
                            void originalPromise
                                .catch(error => console.warn('[Sync] Google disconnect completed with an error:', error))
                                .finally(() => {
                                    if (googleSyncOperationRef.current === originalPromise) {
                                        googleSyncOperationRef.current = null;
                                        setIsGoogleSyncDisconnecting(false);
                                    }
                                });
                            try {
                                await withTimeout(
                                    originalPromise,
                                    15000,
                                    'Google sync disconnect timed out'
                                );
                                showToast('success', 'Google sync disconnected');
                            } catch (error) {
                                showToast('error', googleConnectErrorMessage(error));
                            } finally {
                                setIsProfileMenuOpen(false);
                            }
                        }}
                        disabled={isGoogleSyncDisconnecting}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-red-300 hover:text-red-200 hover:bg-red-500/10 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-60"
                    >
                        {isGoogleSyncDisconnecting ? (
                            <RefreshCw size={13} className="animate-spin" />
                        ) : (
                            <LogOut size={13} />
                        )}
                        <span>{isGoogleSyncDisconnecting ? 'Disconnecting…' : 'Disconnect Drive'}</span>
                    </button>
                )}
                <div className="h-px bg-app-border/40 my-1 mx-1" />
                <button
                    onClick={() => {
                        openPublicUrlsTab();
                        setIsProfileMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-app-text hover:bg-black/5 dark:hover:bg-white/10 rounded-lg flex items-center gap-2 transition-colors"
                >
                    {shareAuth.signed_in && shareAuth.avatar_url ? (
                        <img
                            src={shareAuth.avatar_url}
                            alt=""
                            className="h-[13px] w-[13px] rounded-full object-cover shrink-0"
                            referrerPolicy="no-referrer"
                        />
                    ) : (
                        <Link2 size={13} className="text-app-muted shrink-0" />
                    )}
                    <span className="min-w-0">
                        <span className="block">
                            <PublicUrlsLabel className="text-xs font-medium" />
                        </span>
                        <span className="block text-[10px] font-normal text-app-muted truncate">
                            {shareAuth.signed_in
                                ? 'Signed in to Zync'
                                : 'Sign in to Zync'}
                        </span>
                    </span>
                </button>
                {shareAuth.signed_in && (
                    <button
                        onClick={async () => {
                            try {
                                await shareLogout();
                                showToast('success', 'Signed out of Zync');
                            } catch (error) {
                                showToast('error', parseShareError(error).message);
                            } finally {
                                setIsProfileMenuOpen(false);
                            }
                        }}
                        disabled={shareBusy}
                        className="w-full text-left px-3 py-2 text-xs font-medium text-red-300 hover:text-red-200 hover:bg-red-500/10 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-60"
                    >
                        <LogOut size={13} />
                        <span>Sign out of Zync</span>
                    </button>
                )}
            </TopbarDropdown>
        )}
    </div>);
}
