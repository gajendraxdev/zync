import { StateCreator } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AppStore } from './useAppStore';
import { parseContentPresentation } from '../features/workspace/domain/contentPresentation';
import { parseWorkspaceDocking } from '../features/workspace/domain/docking';
import { assertSupportedMainTabPresentations } from '../features/workspace/domain/mainTabPresentation';
import {
    buildSessionData,
    MAX_TABS_PER_SCOPE,
    SESSION_VERSION,
    type SessionData,
    type TerminalTabSnapshot,
} from './sessionPersistence';

// ─── Slice interface ──────────────────────────────────────────────────────────

/** Acknowledges the captured snapshot, not later changes or other settings files. */
export type SessionSaveResult = { ok: true } | {
    ok: false;
    reason: 'not-ready' | 'superseded' | 'unsupported' | 'failed';
};

export interface SessionSlice {
    /** True once loadSession() has finished (success or failure). Gates UI render. */
    sessionLoaded: boolean;
    /** True for the entire load/restore operation. Suppresses session writes. */
    isRestoring: boolean;
    /** Unsupported snapshots remain untouched until loaded by a compatible app. */
    sessionPersistenceBlocked: boolean;
    /** Invalidates layout previews even when a reload has no restored content. */
    sessionLoadGeneration: number;
    loadSession: () => Promise<void>;
    /** Autosave remains non-throwing; explicit UI actions use the checked variant. */
    saveSession: () => Promise<void>;
    saveSessionChecked: () => Promise<SessionSaveResult>;
}

// ─── Module-level debounce + dirty check ────────────────────────────────────

let _cwdDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let _lastSavedSnapshot = '';
let _pendingSave: Promise<void> = Promise.resolve();
const UNSUPPORTED_SESSION_VERSION = 'SESSION_UNSUPPORTED_VERSION';
const SESSION_BACKUP_FAILED = 'SESSION_BACKUP_FAILED';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasSessionErrorPrefix(error: unknown, prefix: string): boolean {
    const message = typeof error === 'string' ? error : isRecord(error) ? error.message : undefined;
    return typeof message === 'string' && message.startsWith(prefix);
}

/** Bound and validate a scope independently so one malformed scope cannot block the others. */
function restoreSnapshots(raw: unknown): TerminalTabSnapshot[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const snapshots: TerminalTabSnapshot[] = [];
    for (const value of raw) {
        if (!isRecord(value) || typeof value.id !== 'string' || !value.id || seen.has(value.id)
            || typeof value.title !== 'string') continue;
        // Native Option fields serialize as null; older frontend snapshots may omit them.
        if (['cwd', 'initialPath', 'shellOverride'].some(key => value[key] != null && typeof value[key] !== 'string')) continue;
        if (['isSynced', 'tabVisible'].some(key => value[key] != null && typeof value[key] !== 'boolean')) continue;
        snapshots.push({
            id: value.id,
            title: value.title,
            cwd: typeof value.cwd === 'string' ? value.cwd : undefined,
            initialPath: typeof value.initialPath === 'string' ? value.initialPath : undefined,
            shellOverride: typeof value.shellOverride === 'string' ? value.shellOverride : undefined,
            isSynced: typeof value.isSynced === 'boolean' ? value.isSynced : undefined,
            tabVisible: typeof value.tabVisible === 'boolean' ? value.tabVisible : undefined,
        });
        seen.add(value.id);
        if (snapshots.length === MAX_TABS_PER_SCOPE) break;
    }
    return snapshots;
}

/** Debounced wrapper used by setTerminalCwd — fires 1 s after the last call. */
export function scheduleSaveSession(saveSession: () => Promise<void>): void {
    if (_cwdDebounceTimer !== null) clearTimeout(_cwdDebounceTimer);
    _cwdDebounceTimer = setTimeout(() => {
        _cwdDebounceTimer = null;
        saveSession().catch(err => console.warn('[Session] CWD save failed:', err));
    }, 1000);
}

/**
 * Clears the CWD debounce timer and resets the dirty-check snapshot.
 * Call this in tests (afterEach) and HMR cleanup to prevent cross-instance leakage
 * from the module-level mutable state.
 */
export function resetSessionDebounce(): void {
    if (_cwdDebounceTimer !== null) {
        clearTimeout(_cwdDebounceTimer);
        _cwdDebounceTimer = null;
    }
    _lastSavedSnapshot = '';
    _pendingSave = Promise.resolve();
}

// ─── Slice factory ────────────────────────────────────────────────────────────

export const createSessionSlice: StateCreator<AppStore, [], [], SessionSlice> = (set, get) => {
    // A new restore invalidates queued snapshots captured from the preceding state.
    let restoreGeneration = 0;
    let backupFailureNotified = false;
    const canSaveSession = () => get().sessionLoaded && !get().isRestoring && !get().sessionPersistenceBlocked;

    /** Explain the read-only fallback once, without retrying or exposing local paths. */
    const blockUnsupportedSession = (error: unknown) => {
        if (!hasSessionErrorPrefix(error, UNSUPPORTED_SESSION_VERSION) || get().sessionPersistenceBlocked) return;
        set({ sessionPersistenceBlocked: true });
        get().showToast('warning', 'Your saved workspace uses an unsupported format and has been preserved. Workspace changes will not be saved. Update Zync to resume saving.');
    };

    /** Storage failures remain retryable; report one episode without exposing native paths. */
    const warnBackupFailure = (error: unknown) => {
        if (!hasSessionErrorPrefix(error, SESSION_BACKUP_FAILED) || backupFailureNotified) return;
        backupFailureNotified = true;
        get().showToast('warning', 'Workspace changes could not be saved because a recovery copy could not be secured. Your previous saved workspace is unchanged. Saving will be retried on your next change.');
    };

    /**
     * Serialize every captured intent, including a return to the last saved state.
     * Dirty checking before the queue drains would lose A → B → A when B is in
     * flight. Acknowledgement is invalidated by restoration, and errors leave the
     * queue usable and the successful-write cache unchanged for a later retry.
     */
    const saveSessionChecked = async (): Promise<SessionSaveResult> => {
        if (!canSaveSession()) {
            return { ok: false, reason: get().sessionPersistenceBlocked ? 'unsupported' : 'not-ready' };
        }
        const generation = restoreGeneration;
        let data: SessionData;
        let snapshot: string;
        try {
            data = buildSessionData(get());
            snapshot = JSON.stringify(data);
        } catch (error) {
            blockUnsupportedSession(error);
            console.warn('[Session] Failed to prepare session:', error);
            return { ok: false, reason: get().sessionPersistenceBlocked ? 'unsupported' : 'failed' };
        }
        const result = _pendingSave.then(async (): Promise<SessionSaveResult> => {
            if (generation !== restoreGeneration) return { ok: false, reason: 'superseded' };
            if (!canSaveSession()) {
                return { ok: false, reason: get().sessionPersistenceBlocked ? 'unsupported' : 'not-ready' };
            }
            if (snapshot === _lastSavedSnapshot) return { ok: true };
            try {
                await invoke('session_save', { data });
                _lastSavedSnapshot = snapshot;
                backupFailureNotified = false;
                return generation === restoreGeneration ? { ok: true } : { ok: false, reason: 'superseded' };
            } catch (error) {
                // A lost acknowledgement can follow a completed native write.
                // The prior cache is no longer proof of disk contents, even if
                // the next intent returns to that previously saved snapshot.
                _lastSavedSnapshot = '';
                // A superseding load owns format detection and notifications.
                if (generation !== restoreGeneration) return { ok: false, reason: 'superseded' };
                blockUnsupportedSession(error);
                warnBackupFailure(error);
                console.warn('[Session] Failed to save session:', error);
                return { ok: false, reason: get().sessionPersistenceBlocked ? 'unsupported' : 'failed' };
            }
        });
        _pendingSave = result.then(() => undefined);
        return result;
    };

    return {
        sessionLoaded: false,
        isRestoring: false,
        sessionPersistenceBlocked: false,
        sessionLoadGeneration: 0,

        loadSession: async () => {
            const generation = ++restoreGeneration;
            set({ isRestoring: true, sessionLoadGeneration: generation });
            try {
                // Finish an already-dispatched write before reading; queued stale
                // snapshots observe the new generation and are discarded instead.
                await _pendingSave;
                if (generation !== restoreGeneration) return;
                // A reload may observe external edits or a deleted file. The old
                // successful-write cache no longer describes the disk contents.
                _lastSavedSnapshot = '';
                const data = await invoke<SessionData | null>('session_load');
                if (generation !== restoreGeneration) return;
                if (data !== null && (!isRecord(data) || !Number.isInteger(data.version)
                    || data.version < 0 || data.version > SESSION_VERSION)) {
                    throw new Error(`${UNSUPPORTED_SESSION_VERSION}: unsupported session snapshot`);
                }
                const presentation = parseContentPresentation(data?.contentPresentation);
                if (!presentation.ok) throw new Error(`${UNSUPPORTED_SESSION_VERSION}: unsupported content presentation metadata`);
                const docking = parseWorkspaceDocking(data?.workspaceDocking);
                if (!docking.ok) throw new Error(`${UNSUPPORTED_SESSION_VERSION}: unsupported workspace docking metadata`);
                assertSupportedMainTabPresentations(data?.tabs);
                set({ sessionPersistenceBlocked: false });
                set({ contentPresentation: presentation.value, workspaceDocking: docking.value, workspaceDockFocus: {}, maximizedWorkspacePanes: {} });
                if (!data) return;

                // Phase 2: restore sidebar tabs (connections must already be loaded).
                get().restoreTabState(
                    Array.isArray(data.tabs) ? data.tabs : [],
                    data.activeTabId ?? null,
                    data.activeConnectionId ?? null,
                    data.showWelcomeScreen ?? false,
                );

                // Phase 3: restore scopes even when they contain only feature/plugin panes.
                // Local tabs get live PTYs; SSH tabs are metadata-only until reconnect.
                const knownConnectionIds = new Set(get().connections.map(c => c.id));
                const terminals = isRecord(data.terminals) ? data.terminals : {};
                const paneLayouts = isRecord(data.paneLayouts) ? data.paneLayouts : {};
                const activeTerminalIds = isRecord(data.activeTerminalIds) ? data.activeTerminalIds : {};
                const scopeIds = new Set([...Object.keys(terminals), ...Object.keys(paneLayouts)]);
                for (const scopeId of scopeIds) {
                    // Skip orphaned scopes — connection was deleted since last session.
                    if (scopeId !== 'local' && !knownConnectionIds.has(scopeId)) continue;
                    const snapshots = restoreSnapshots(terminals[scopeId]);
                    const paneLayout = paneLayouts[scopeId];
                    if (!snapshots.length && !isRecord(paneLayout)) continue;
                    const activeTerminalId = activeTerminalIds[scopeId];
                    get().restoreTerminalTabs(
                        scopeId,
                        snapshots,
                        typeof activeTerminalId === 'string' ? activeTerminalId : null,
                        paneLayout,
                    );
                }

                // SSH hosts stay disconnected after restore. User reconnects explicitly
                // (sidebar open / reconnect UI) — no surprise connect on launch.
            } catch (e) {
                if (generation !== restoreGeneration) return;
                blockUnsupportedSession(e);
                console.warn('[Session] Failed to load session:', e);
            } finally {
                // Only the current load owns the startup gate, including failures.
                if (generation === restoreGeneration) {
                    backupFailureNotified = false;
                    set({ sessionLoaded: true, isRestoring: false });
                }
            }
        },

        saveSessionChecked,
        saveSession: async () => { await saveSessionChecked(); },
    };
};
