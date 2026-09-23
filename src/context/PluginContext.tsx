import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ipcRenderer } from '../lib/tauri-ipc';
import { registerThemePluginModes } from '../lib/themeModeRegistry';
import { notify } from '../features/notifications';
import { parsePluginUiNotify } from '../features/notifications/pluginNotify';
import {
    createPluginNotifyActionRequestId,
    rejectAllPendingPluginNotifyActions,
    rejectPendingPluginNotifyActionsForPlugin,
    resolvePluginNotifyActionResponse,
    waitForPluginNotifyActionResult,
} from '../features/notifications/pluginNotifyAction';
import { useAppStore } from '../store/useAppStore';
import { confirmPluginTerminalAction } from '../features/plugins/confirmPluginTerminalAction';
import {
    filterUnsupportedHostThemes,
    filterTrustedBuiltinThemeChoices,
    handleWorkerTerminalCommand,
    isTrustedBuiltinTheme,
    postCurrentWorkerResponse,
} from '../features/plugins/pluginCommandBridge';
import type { Plugin } from '../features/plugins/types';
import {
    authorizePluginCapability,
    authorizePluginCommandRegistration,
    clearNativePluginRuntimeFailures,
    clearNativePluginSafeMode,
    getNativePluginRecoveryStatus,
    recordNativePluginRuntimeFailure,
    registerNativePluginPane,
    bindNativePluginPaneConnection,
    resetNativePluginRuntimes,
    startNativePluginRuntime,
    stopNativePluginRuntime,
    unbindNativePluginPaneConnection,
    type NativePluginRecoveryStatus,
    type PluginRuntimeFailureKind,
} from '../features/plugins/runtime/nativePluginRuntime';
import {
    deletePluginStorageValue,
    getPluginStorageValue,
    listPluginStorageKeys,
    setPluginStorageValue,
} from '../features/plugins/runtime/pluginStorage';
import { validatePluginPaneMessage } from '../features/plugins/runtime/paneMessages';
import { fetchPluginNetworkResource } from '../features/plugins/runtime/pluginNetwork';
import { handlePluginFilesystemMessage } from '../features/plugins/runtime/pluginFilesystem';
import { PluginPaneBindingQueue } from '../features/plugins/runtime/pluginPaneBindingQueue';
import {
    normalizePluginConfirmRequest,
    PluginMessageRateLimiter,
} from '../features/plugins/runtime/pluginMessageRateLimiter';
import {
    PluginRuntimeSupervisor,
    type PluginRuntimeHealth,
} from '../features/plugins/runtime/pluginRuntimeSupervisor';
import { autoRollbackPlugin } from '../features/plugins/runtime/pluginAutoRollback';
import {
    getPluginManagementDetails,
    rollbackPluginVersion,
} from '../features/plugins/management/pluginManagement';

export type { Plugin } from '../features/plugins/types';

interface PluginCommand {
    id: string;
    title: string;
    pluginId: string;
}

interface PluginPanel {
    id: string;
    title: string;
    html: string;
    pluginId: string;
    allowMultiple: boolean;
    legacyAccess: boolean;
}

interface PluginContextType {
    plugins: Plugin[];
    editorProviders: Plugin[];
    loaded: boolean;
    commands: PluginCommand[];
    panels: PluginPanel[];
    runtimeHealth: PluginRuntimeHealth[];
    pluginSafeMode: boolean;
    executeCommand: (id: string) => void;
    reloadPlugins: (healthCheckPluginId?: string) => Promise<boolean>;
    retryPluginRuntime: (pluginId: string) => Promise<boolean>;
    exitPluginSafeMode: () => Promise<boolean>;
    postPaneMessage: (pluginId: string, panelId: string, paneInstanceId: string, message: unknown) => boolean;
    registerPaneMessageTarget: (
        pluginId: string,
        panelId: string,
        paneInstanceId: string,
        connectionId: string,
        post: (message: unknown) => void,
    ) => () => void;
}

const PluginContext = createContext<PluginContextType>({
    plugins: [],
    editorProviders: [],
    loaded: false,
    commands: [],
    panels: [],
    runtimeHealth: [],
    pluginSafeMode: false,
    executeCommand: () => { },
    reloadPlugins: async () => false,
    retryPluginRuntime: async () => false,
    exitPluginSafeMode: async () => false,
    postPaneMessage: () => false,
    registerPaneMessageTarget: () => () => { },
});

export const usePlugins = () => useContext(PluginContext);

/** Host-generated fallback ids for plugin notifies with actions (unique within process). */
let pluginNotifySeq = 0;
/** Prevents double-click concurrent RPC for the same notification action. */
const pluginNotifyActionsInFlight = new Set<string>();
const PLUGIN_HEARTBEAT_INTERVAL_MS = 5_000;
const PLUGIN_HEARTBEAT_TIMEOUT_MS = 15_000;
const PLUGIN_ACTIVATION_TIMEOUT_MS = 5_000;

function requiresLegacyWorkerBridge(type: string): boolean {
    return type.startsWith('api:fs:')
        || type.startsWith('api:window:')
        || type === 'api:theme:set'
        || type === 'api:statusbar:set'
        || type === 'api:plugins:load'
        || type === 'api:terminal:send';
}

// The code that runs INSIDE the Web Worker
// We use a template literal to inject it securely
const WORKER_BOOTSTRAP = `
const denyAmbientNetwork = () => Promise.reject(new Error(
    'Direct network access is disabled. Use zync.network.fetch for an approved host.'
));
const denyAmbientNetworkConstructor = function () {
    throw new Error('Direct network access is disabled. Use the Zync network API.');
};
const blockedNetworkGlobals = {
    fetch: denyAmbientNetwork,
    XMLHttpRequest: denyAmbientNetworkConstructor,
    WebSocket: denyAmbientNetworkConstructor,
    EventSource: denyAmbientNetworkConstructor,
    Worker: denyAmbientNetworkConstructor,
    SharedWorker: denyAmbientNetworkConstructor,
    importScripts: denyAmbientNetworkConstructor,
};
for (const [name, replacement] of Object.entries(blockedNetworkGlobals)) {
    let target = self;
    while (target) {
        if (Object.prototype.hasOwnProperty.call(target, name)) {
            try {
                Object.defineProperty(target, name, {
                    value: replacement,
                    writable: false,
                    configurable: false,
                });
            } catch {}
        }
        target = Object.getPrototypeOf(target);
    }
    try {
        Object.defineProperty(self, name, {
            value: replacement,
            writable: false,
            configurable: false,
        });
    } catch {}
}

const zync = {
    callbacks: {},
    commandHandlers: {},
    pendingRequests: {},
    
    on: (event, callback) => {
        if (!zync.callbacks[event]) zync.callbacks[event] = [];
        zync.callbacks[event].push(callback);
        return () => {
            const callbacks = zync.callbacks[event] || [];
            zync.callbacks[event] = callbacks.filter(candidate => candidate !== callback);
        };
    },

    emit: (event, data) => {
        if (zync.callbacks[event]) {
            zync.callbacks[event].forEach(cb => cb(data));
        }
    },

    // Generic Request helper
    request: (type, payload) => {
        return new Promise((resolve, reject) => {
             const requestId = Math.random().toString(36).substring(7);
             zync.pendingRequests[requestId] = { resolve, reject };
             self.postMessage({ type, payload: { ...payload, requestId } });
        });
    },

    ui: {
        /**
         * Show a host toast / inbox notification.
         * JSON-only options (no functions). Host tags source as plugin:<id>.
         * Supported: type, message|body|title, duration, persist, silent, history,
         * channel ('auto'|'toast'|'inbox'|'both'), id, actions: [{ id, label, dismiss? }].
         * Action clicks are delivered back as api:ui:notify:action (or zync.ui.onNotifyAction).
         */
        notify: (opts) => zync.request('api:ui:notify', opts),
        /** Show a Zync-owned confirmation dialog after the plugin is granted permission. */
        confirm: (opts) => zync.request('api:ui:confirm', opts),
        /**
         * Register a handler for notification action button clicks.
         * payload: { requestId, pluginId, actionId, notificationId?, message, type }
         * Handler may be async and may return { ok: false, error: '...' } to fail the action.
         * Returns an unsubscribe function.
         */
        onNotifyAction: (callback) => {
            if (typeof callback !== 'function') return () => {};
            if (!zync.callbacks['ui:notify:action']) zync.callbacks['ui:notify:action'] = [];
            zync.callbacks['ui:notify:action'].push(callback);
            return () => {
                const list = zync.callbacks['ui:notify:action'] || [];
                zync.callbacks['ui:notify:action'] = list.filter(cb => cb !== callback);
            };
        },
    },

    fs: {
        readFile: (path) => zync.request('api:fs:read', { path }),
        writeFile: (path, content) => zync.request('api:fs:write', { path, content }),
        ls: (path) => zync.request('api:fs:list', { path }),
        exists: (path) => zync.request('api:fs:exists', { path }),
        mkdir: (path) => zync.request('api:fs:mkdir', { path }),
    },

    commands: {
        register: (id, title, handler) => {
            zync.commandHandlers[id] = handler;
            return zync.request('api:commands:register', { id, title }).catch(error => {
                if (zync.commandHandlers[id] === handler) delete zync.commandHandlers[id];
                throw error;
            });
        }
    },

    storage: {
        get: (key) => zync.request('api:storage:get', { key }),
        keys: () => zync.request('api:storage:keys', {}),
        set: (key, value) => zync.request('api:storage:set', { key, value }),
        delete: (key) => zync.request('api:storage:delete', { key }),
    },

    network: {
        fetch: (url, options = {}) => zync.request('api:network:fetch', {
            url,
            accept: options.accept,
        }),
    },

    filesystem: {
        pickFile: () => zync.request('api:filesystem:pick', { kind: 'file' }),
        pickDirectory: () => zync.request('api:filesystem:pick', { kind: 'directory' }),
        pickWriteFile: () => zync.request('api:filesystem:pick-write-file', {}),
        readText: (handle, relativePath) => zync.request('api:filesystem:read-text', {
            handle,
            relativePath,
        }),
        writeText: (handle, content) => zync.request('api:filesystem:write-text', {
            handle,
            content,
        }),
        list: (handle, relativePath) => zync.request('api:filesystem:list', {
            handle,
            relativePath,
        }),
    },

    sshFilesystem: {
        list: (paneInstanceId, relativePath) => zync.request('api:ssh-filesystem:list', {
            paneInstanceId,
            relativePath,
        }),
        readText: (paneInstanceId, relativePath) => zync.request('api:ssh-filesystem:read-text', {
            paneInstanceId,
            relativePath,
        }),
    },
    
    theme: {
        set: (themeName) => {
            self.postMessage({ type: 'api:theme:set', payload: { theme: themeName } });
        }
    },

    terminal: {
        send: (text) => {
            self.postMessage({ type: 'api:terminal:send', payload: { text } });
        }
    },

    statusBar: {
        set: (id, text) => {
            self.postMessage({ type: 'api:statusbar:set', payload: { id, text } });
        },
        clear: (id) => {
            self.postMessage({ type: 'api:statusbar:set', payload: { id, text: '' } });
        }
    },

    panel: {
        onMessage: (callback) => zync.on('pane:message', callback),
        postMessage: (paneInstanceId, message) => zync.request('api:panel:post-message', { paneInstanceId, message }),
        register: (id, title, html) => zync.request('api:panel:register', { id, title, html })
    },

    window: {
        showQuickPick: (items, options) => {
            return zync.request('api:window:showQuickPick', { items, options });
        }
    },

    plugins: {
        list: () => zync.request('api:plugins:load', {})
    },

    logger: {
        log: (msg) => {
            self.postMessage({ type: 'api:log', payload: msg });
        }
    }
};

self.onmessage = async (e) => {
    const { type, payload } = e.data;
    
    // Handle Responses
    if (type.endsWith(':response')) {
         const { requestId, result, error } = payload;
         // Special handling for Quick Pick legacy format (optional, but good for robust)
         // Actually, if we standardized zync.request, we use zync.pendingRequests
         
         const handler = zync.pendingRequests[requestId];
         if (handler) {
             if (error) handler.reject(error);
             else handler.resolve(result); // Result might be selectedItem or file content
             delete zync.pendingRequests[requestId];
         }
         return;
    }
    
    if (type === 'host:heartbeat:ping') {
        self.postMessage({ type: 'host:heartbeat:pong', payload: { nonce: payload && payload.nonce } });
    } else if (type === 'init') {
        const callbacks = zync.callbacks.ready || [];
        for (const callback of callbacks) await callback();
        self.postMessage({ type: 'host:runtime:ready', payload: {} });
    } else if (type === 'command:execute') {
        const handler = zync.commandHandlers[payload.id];
        if (handler) await handler();
    } else if (type === 'pane:message') {
        zync.emit('pane:message', payload);
    } else if (type === 'api:ui:notify:action') {
        const requestId = payload && payload.requestId;
        const respond = (result, error) => {
            if (!requestId) return;
            self.postMessage({
                type: 'api:ui:notify:action:response',
                payload: error
                    ? { requestId, error: String(error) }
                    : { requestId, result: result ?? { ok: true } },
            });
        };
        try {
            const callbacks = zync.callbacks['ui:notify:action'] || [];
            let lastResult = { ok: true };
            for (const cb of callbacks) {
                const out = await cb(payload);
                if (out && typeof out === 'object') {
                    lastResult = out;
                }
            }
            if (lastResult && lastResult.ok === false) {
                respond(lastResult, lastResult.error || 'Action failed');
            } else {
                respond(lastResult || { ok: true });
            }
        } catch (err) {
            respond(null, err && err.message ? err.message : String(err || 'Action failed'));
        }
    }
};

// Expose zync globally to the user script
self.zync = zync;
`;

export const PluginProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [commands, setCommands] = useState<PluginCommand[]>([]);
    const [panels, setPanels] = useState<PluginPanel[]>([]);
    const [runtimeHealth, setRuntimeHealth] = useState<PluginRuntimeHealth[]>([]);
    const [pluginSafeMode, setPluginSafeMode] = useState(false);
    const runtimeSupervisor = useRef(new PluginRuntimeSupervisor<Worker>());
    const paneMessageTargets = useRef(new Map<string, {
        panelId: string;
        post: (message: unknown) => void;
    }>());
    const paneBindingQueue = useRef(new PluginPaneBindingQueue());
    const trustedBuiltinThemes = useRef<Plugin[]>([]);
    const reloadPluginsRef = useRef<(healthCheckPluginId?: string) => Promise<boolean>>(async () => false);
    const autoRollbackInFlight = useRef(new Set<string>());
    const autoRollbackAttemptedVersions = useRef(new Set<string>());
    const editorProviders = useMemo(
        () => plugins.filter((plugin) => (
            plugin.enabled
            && plugin.manifest.type === 'editor-provider'
            && (!pluginSafeMode || plugin.path.startsWith('builtin://'))
        )),
        [pluginSafeMode, plugins]
    );

    const attemptAutomaticRollback = useCallback(async (pluginId: string) => {
        if (autoRollbackInFlight.current.has(pluginId)) return;
        autoRollbackInFlight.current.add(pluginId);
        try {
            const details = await getPluginManagementDetails(pluginId);
            const attemptKey = `${pluginId}@${details.version}`;
            if (!details.rollback || autoRollbackAttemptedVersions.current.has(attemptKey)) return;
            autoRollbackAttemptedVersions.current.add(attemptKey);

            const result = await autoRollbackPlugin(pluginId, {
                rollback: rollbackPluginVersion,
                clearFailures: clearNativePluginRuntimeFailures,
                clearQuarantine: id => runtimeSupervisor.current.clearQuarantine(id),
                reloadAndCheck: id => reloadPluginsRef.current(id),
            });
            if (result.status === 'restored') {
                notify.warning(
                    `Plugin ${pluginId} crashed repeatedly. Zync restored version ${result.restoredVersion}.`,
                    { history: true, source: `plugin:${pluginId}` },
                );
                return;
            }
            notify.error(
                result.runtimeHealthy
                    ? `Plugin version ${result.failedVersion} also failed. Zync restored version ${result.restoredVersion}.`
                    : `Plugin recovery failed for ${pluginId}. The plugin remains stopped.`,
                { persist: !result.runtimeHealthy, history: true, source: `plugin:${pluginId}` },
            );
        } catch (error) {
            // No retained package is a normal state for a first install. The runtime stays
            // quarantined and Settings continues to offer the existing retry controls.
            console.error(`[Plugins] Automatic rollback was unavailable for ${pluginId}:`, error);
        } finally {
            autoRollbackInFlight.current.delete(pluginId);
        }
    }, []);

    const persistFailureAndRecover = useCallback((
        pluginId: string,
        failureKind: PluginRuntimeFailureKind,
    ) => {
        void recordNativePluginRuntimeFailure(pluginId, failureKind)
            .catch(error => {
                console.error('[Plugins] Failed to persist runtime diagnostic:', error);
            })
            .finally(() => {
                const health = runtimeSupervisor.current.snapshot()
                    .find(item => item.pluginId === pluginId);
                if (health?.status === 'quarantined') void attemptAutomaticRollback(pluginId);
            });
    }, [attemptAutomaticRollback]);

    const cleanUpFailedRuntime = useCallback((
        pluginId: string,
        runtimeInstanceId: string | null,
        failureKind: PluginRuntimeFailureKind,
    ) => {
        rejectPendingPluginNotifyActionsForPlugin(pluginId, 'Plugin runtime stopped');
        setCommands(previous => previous.filter(command => command.pluginId !== pluginId));
        setPanels(previous => previous.filter(panel => panel.pluginId !== pluginId));
        if (runtimeInstanceId) void stopNativePluginRuntime(runtimeInstanceId);
        persistFailureAndRecover(pluginId, failureKind);
    }, [persistFailureAndRecover]);

    useEffect(() => {
        const unsubscribeHealth = runtimeSupervisor.current.subscribe(setRuntimeHealth);
        const heartbeatTimer = window.setInterval(() => {
            const heartbeat = runtimeSupervisor.current.pollHeartbeats(PLUGIN_HEARTBEAT_TIMEOUT_MS);
            heartbeat.probes.forEach(({ worker, nonce }) => {
                worker.postMessage({ type: 'host:heartbeat:ping', payload: { nonce } });
            });
            heartbeat.unresponsive.forEach(({ pluginId, runtimeInstanceId }) => {
                cleanUpFailedRuntime(pluginId, runtimeInstanceId, 'heartbeat-timeout');
            });
        }, PLUGIN_HEARTBEAT_INTERVAL_MS);
        void reloadPlugins();
        return () => {
            window.clearInterval(heartbeatTimer);
            rejectAllPendingPluginNotifyActions('Plugins shutting down');
            runtimeSupervisor.current.stopAll(pluginId => {
                rejectPendingPluginNotifyActionsForPlugin(pluginId, 'Plugins shutting down');
            });
            paneMessageTargets.current.clear();
            paneBindingQueue.current.clear();
            unsubscribeHealth();
            void resetNativePluginRuntimes().catch((error) => {
                console.error('[Plugins] Failed to reset native runtimes during shutdown:', error);
            });
            trustedBuiltinThemes.current = [];
            document.querySelectorAll('style[data-zync-builtin-theme]').forEach(style => style.remove());
        };
    }, []);

    const reloadPlugins = async (healthCheckPluginId?: string): Promise<boolean> => {
        try {
            await resetNativePluginRuntimes();
            runtimeSupervisor.current.stopAll(pluginId => {
                rejectPendingPluginNotifyActionsForPlugin(pluginId, 'Plugin reloaded');
            });
            if (healthCheckPluginId) {
                // An explicit activation check is a fresh generation. Old crash-loop state
                // must not prevent the package the user just installed or restored from starting.
                await clearNativePluginRuntimeFailures(healthCheckPluginId);
                runtimeSupervisor.current.clearQuarantine(healthCheckPluginId);
            }
            const loadedPlugins: Plugin[] = await ipcRenderer.invoke('plugins:load');
            let recovery: NativePluginRecoveryStatus;
            try {
                recovery = await getNativePluginRecoveryStatus();
            } catch (error) {
                // If recovery state cannot be trusted, keep third-party code stopped while
                // leaving built-in plugins available so the user can still repair the app.
                console.error('[Plugins] Failed to read runtime recovery state:', error);
                recovery = { safeMode: true, diagnostics: [] };
            }
            setPluginSafeMode(recovery.safeMode);
            recovery.diagnostics.forEach(diagnostic => {
                runtimeSupervisor.current.restoreFailures(
                    diagnostic.pluginId,
                    diagnostic.failures.map(failure => failure.atMs),
                    diagnostic.failures[diagnostic.failures.length - 1]?.kind,
                );
            });
            console.log('[Plugins] Discovered:', loadedPlugins);

            // Only app-owned built-in themes may style the host document or start a theme runtime.
            const hostCompatiblePlugins = filterUnsupportedHostThemes(loadedPlugins);
            const enabledPlugins = hostCompatiblePlugins.filter(plugin => plugin.enabled);
            trustedBuiltinThemes.current = enabledPlugins.filter(isTrustedBuiltinTheme);
            runtimeSupervisor.current.syncKnownPlugins(hostCompatiblePlugins.map(plugin => ({
                pluginId: plugin.manifest.id,
                enabled: plugin.enabled,
                runnable: typeof plugin.script === 'string' && plugin.script.length > 0,
                safeModeBlocked: recovery.safeMode && !plugin.path.startsWith('builtin://'),
            })));
            const runnablePlugins = hostCompatiblePlugins.filter((plugin): plugin is Plugin & { script: string } => (
                plugin.enabled
                && (!recovery.safeMode || plugin.path.startsWith('builtin://'))
                && typeof plugin.script === 'string'
                && plugin.script.length > 0
            ));
            const healthCheckPlugin = healthCheckPluginId
                ? hostCompatiblePlugins.find(plugin => plugin.manifest.id === healthCheckPluginId)
                : undefined;
            if (healthCheckPluginId && !healthCheckPlugin) return false;
            const targetBlockedBySafeMode = Boolean(
                healthCheckPlugin
                && recovery.safeMode
                && !healthCheckPlugin.path.startsWith('builtin://'),
            );
            let targetRuntimeCheck: 'healthy' | 'failed' | 'unchecked' = !healthCheckPlugin
                ? 'healthy'
                : targetBlockedBySafeMode
                    || !healthCheckPlugin.enabled
                    || typeof healthCheckPlugin.script !== 'string'
                    || healthCheckPlugin.script.length === 0
                    ? 'unchecked'
                    : 'failed';

            document.querySelectorAll('style[data-zync-builtin-theme]').forEach(style => style.remove());
            enabledPlugins.forEach(plugin => {
                if (!isTrustedBuiltinTheme(plugin) || !plugin.style) return;
                const style = document.createElement('style');
                style.dataset.zyncBuiltinTheme = plugin.manifest.id;
                style.textContent = plugin.style;
                document.head.appendChild(style);
            });

            // Third-party manifest.style is never injected. Editor styles remain inside
            // EditorPluginFrame; builtin:// theme CSS is trusted app-owned content.
            registerThemePluginModes(enabledPlugins);
            window.dispatchEvent(new CustomEvent('zync:theme-registry-ready'));
            setPlugins(loadedPlugins);
            // Commands and panes belong to a Worker generation. Keeping registrations from the
            // previous generation makes removed commands look alive after an update.
            setCommands([]);
            setPanels([]);
            paneMessageTargets.current.clear();
            paneBindingQueue.current.clear();

            // Initialize Workers
            for (const plugin of runnablePlugins) {
                if (!runtimeSupervisor.current.beginStart(plugin.manifest.id)) continue;
                let runtimeInstanceId: string | null = null;
                try {
                    runtimeInstanceId = await startNativePluginRuntime(plugin.manifest.id);
                    // Combine bootstrap + user script
                    const blobContent = [WORKER_BOOTSTRAP, '\n\n// USER SCRIPT START\n\n', plugin.script];
                    const blob = new Blob(blobContent, { type: 'application/javascript' });
                    const workerUrl = URL.createObjectURL(blob);

                    const worker = new Worker(workerUrl);
                    URL.revokeObjectURL(workerUrl);
                    const messageRateLimiter = new PluginMessageRateLimiter();
                    let finishActivationCheck: ((healthy: boolean) => void) | null = null;
                    const activationCheck = plugin.manifest.id === healthCheckPluginId
                        ? new Promise<boolean>(resolve => {
                            finishActivationCheck = resolve;
                        })
                        : null;

                    // Handle messages FROM the worker
                    worker.onmessage = (e) => {
                        const { type, payload } = e.data;
                        if (!messageRateLimiter.consume()) {
                            const crashedRuntimeId = runtimeSupervisor.current.markCrash(
                                plugin.manifest.id,
                                worker,
                                'Plugin Worker exceeded the host message rate limit',
                            );
                            if (crashedRuntimeId) {
                                cleanUpFailedRuntime(plugin.manifest.id, crashedRuntimeId, 'worker-error');
                            }
                            return;
                        }
                        if (type === 'host:heartbeat:pong') {
                            runtimeSupervisor.current.acknowledgeHeartbeat(
                                plugin.manifest.id,
                                worker,
                                payload?.nonce,
                            );
                            return;
                        }
                        if (type === 'host:runtime:ready') {
                            finishActivationCheck?.(true);
                            finishActivationCheck = null;
                            return;
                        }
                        handlePluginMessage(plugin.manifest.id, type, payload, worker);
                    };

                    worker.onerror = (e) => {
                        console.error(`[Plugin Error] ${plugin.manifest.id}:`, e.message);
                        const crashedRuntimeId = runtimeSupervisor.current.markCrash(
                            plugin.manifest.id,
                            worker,
                            e.message || 'Plugin Worker crashed',
                        );
                        finishActivationCheck?.(false);
                        finishActivationCheck = null;
                        if (!crashedRuntimeId) return;
                        cleanUpFailedRuntime(plugin.manifest.id, crashedRuntimeId, 'worker-error');
                    };

                    runtimeSupervisor.current.attach(plugin.manifest.id, worker, runtimeInstanceId);

                    // Start only after both the frontend Worker and native runtime identities exist.
                    worker.postMessage({ type: 'init' });

                    if (activationCheck) {
                        const timeout = new Promise<boolean>(resolve => {
                            window.setTimeout(() => resolve(false), PLUGIN_ACTIVATION_TIMEOUT_MS);
                        });
                        const runtimeHealthy = await Promise.race([activationCheck, timeout]);
                        targetRuntimeCheck = runtimeHealthy ? 'healthy' : 'failed';
                        if (!runtimeHealthy && runtimeSupervisor.current.isCurrentWorker(
                            plugin.manifest.id,
                            worker,
                        )) {
                            const crashedRuntimeId = runtimeSupervisor.current.markCrash(
                                plugin.manifest.id,
                                worker,
                                'Plugin did not become ready during activation',
                            );
                            if (crashedRuntimeId) {
                                cleanUpFailedRuntime(
                                    plugin.manifest.id,
                                    crashedRuntimeId,
                                    'start-failure',
                                );
                            }
                        }
                    }

                } catch (err) {
                    console.error(`[Plugin] Failed to start ${plugin.manifest.id}:`, err);
                    runtimeSupervisor.current.markStartFailure(plugin.manifest.id, err);
                    persistFailureAndRecover(plugin.manifest.id, 'start-failure');
                    if (runtimeInstanceId) {
                        void stopNativePluginRuntime(runtimeInstanceId);
                    }
                    if (plugin.manifest.id === healthCheckPluginId) {
                        targetRuntimeCheck = 'failed';
                    }
                }
            }

            setLoaded(true);
            // Recovery state can restore a crash-loop quarantine before any new Worker starts.
            // Defer rollback until this reload has fully released the current generation.
            runtimeSupervisor.current.snapshot()
                .filter(health => health.status === 'quarantined')
                .forEach(health => {
                    window.setTimeout(() => void attemptAutomaticRollback(health.pluginId), 0);
                });
            return targetRuntimeCheck !== 'failed';
        } catch (err) {
            console.error('[Plugins] Failed to load:', err);
            return false;
        }
    };

    const respond = (requester: Worker, pluginId: string, type: string, payload: Record<string, unknown>) => {
        postCurrentWorkerResponse(
            requester,
            candidate => runtimeSupervisor.current.isCurrentWorker(pluginId, candidate),
            type,
            payload,
        );
    };

    const handlePluginMessage = async (pluginId: string, type: string, payload: any, requester: Worker) => {
        if (!runtimeSupervisor.current.isCurrentWorker(pluginId, requester)) return;
        if (requiresLegacyWorkerBridge(type)) {
            const runtimeInstanceId = runtimeSupervisor.current.getRuntimeInstanceId(pluginId);
            try {
                if (!runtimeInstanceId) throw new Error('Plugin runtime is not registered');
                await authorizePluginCapability(runtimeInstanceId, 'legacy.compatibility');
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                respond(requester, pluginId, type, {
                    requestId: payload?.requestId,
                    error: message,
                });
                return;
            }
            if (
                !runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                || !runtimeSupervisor.current.isCurrentRuntime(pluginId, runtimeInstanceId)
            ) return;
        }
        if (type === 'api:terminal:send' && await handleWorkerTerminalCommand({
            type,
            payload,
            pluginId,
            requester,
            isCurrent: candidate => runtimeSupervisor.current.isCurrentWorker(pluginId, candidate as Worker),
            confirm: confirmPluginTerminalAction,
            getActiveConnectionId: () => useAppStore.getState().activeConnectionId,
            dispatch: (eventType, detail) => window.dispatchEvent(new CustomEvent(eventType, { detail })),
        })) return;
        const filesystemRuntimeId = runtimeSupervisor.current.getRuntimeInstanceId(pluginId);
        if (await handlePluginFilesystemMessage({
            type,
            payload,
            runtimeInstanceId: filesystemRuntimeId,
            isCurrent: () => (
                runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                && Boolean(filesystemRuntimeId)
                && runtimeSupervisor.current.isCurrentRuntime(pluginId, filesystemRuntimeId!)
            ),
            respond: response => respond(requester, pluginId, type, response),
        })) return;

        // API Implementation Bridge
        switch (type) {
            case 'api:panel:register': {
                const runtimeInstanceId = runtimeSupervisor.current.getRuntimeInstanceId(pluginId);
                const requestId = payload?.requestId;
                if (!runtimeInstanceId) {
                    respond(requester, pluginId, type, {
                        requestId,
                        error: 'Plugin runtime is not registered',
                    });
                    break;
                }
                let registered;
                try {
                    registered = await registerNativePluginPane(runtimeInstanceId, payload?.id);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    respond(requester, pluginId, type, { requestId, error: message });
                    break;
                }
                if (
                    !runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                    || !runtimeSupervisor.current.isCurrentRuntime(pluginId, runtimeInstanceId)
                ) break;
                const panel = registered ?? {
                    id: payload?.id,
                    title: payload?.title,
                    html: payload?.html,
                    allowMultiple: false,
                    legacy: true,
                };
                setPanels(prev => {
                    if (prev.some(existing => existing.id === panel.id)) return prev;
                    return [...prev, {
                        id: panel.id,
                        title: panel.title,
                        html: panel.html,
                        pluginId,
                        allowMultiple: panel.allowMultiple,
                        legacyAccess: panel.legacy,
                    }];
                });
                window.dispatchEvent(new CustomEvent('zync:panel:register', {
                    detail: { id: panel.id, title: panel.title, pluginId },
                }));
                respond(requester, pluginId, type, {
                    requestId,
                    result: { id: panel.id, title: panel.title },
                });
                break;
            }
            case 'api:panel:post-message': {
                const paneInstanceId = typeof payload?.paneInstanceId === 'string'
                    ? payload.paneInstanceId
                    : '';
                const parsed = validatePluginPaneMessage(payload?.message);
                const target = paneMessageTargets.current.get(`${pluginId}\0${paneInstanceId}`);
                if (!paneInstanceId || !parsed.ok || !target) {
                    respond(requester, pluginId, type, {
                        requestId: payload?.requestId,
                        error: 'Plugin pane is unavailable or the message is invalid',
                    });
                    break;
                }
                target.post(parsed.message);
                respond(requester, pluginId, type, {
                    requestId: payload.requestId,
                    result: true,
                });
                break;
            }
            case 'api:ui:notify': {
                const runtimeInstanceId = runtimeSupervisor.current.getRuntimeInstanceId(pluginId);
                const requestId = payload?.requestId;
                if (!runtimeInstanceId) {
                    respond(requester, pluginId, type, {
                        requestId,
                        error: 'Plugin runtime is not registered',
                    });
                    break;
                }
                try {
                    await authorizePluginCapability(runtimeInstanceId, 'ui.notifications.emit');
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    respond(requester, pluginId, type, { requestId, error: message });
                    break;
                }
                if (
                    !runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                    || !runtimeSupervisor.current.isCurrentRuntime(pluginId, runtimeInstanceId)
                ) break;
                const parsed = parsePluginUiNotify(pluginId, payload);
                const options = { ...parsed.options };
                // Collision-resistant host id when the plugin did not supply one.
                if (parsed.actionSpecs.length > 0 && !options.id) {
                    pluginNotifySeq += 1;
                    options.id = `plugin-notify-${pluginId}-${Date.now().toString(36)}-${pluginNotifySeq.toString(36)}`;
                }
                if (parsed.actionSpecs.length > 0) {
                    options.actions = parsed.actionSpecs.map((spec) => {
                        // Host waits for RPC before dismiss; preserve caller's dismiss intent for success.
                        const dismissOnSuccess = spec.dismiss !== false;
                        return {
                            ...spec,
                            dismiss: false,
                            onClick: () => {
                                const worker = requester;
                                if (!runtimeSupervisor.current.isCurrentWorker(pluginId, worker)) {
                                    notify.error('Plugin is not running', {
                                        source: `plugin:${pluginId}`,
                                    });
                                    return;
                                }
                                const notificationId = options.id;
                                const flightKey = `${pluginId}:${notificationId ?? ''}:${spec.id}`;
                                if (pluginNotifyActionsInFlight.has(flightKey)) return;
                                pluginNotifyActionsInFlight.add(flightKey);

                                const requestId = createPluginNotifyActionRequestId();
                                const wait = waitForPluginNotifyActionResult(requestId, pluginId);
                                worker.postMessage({
                                    type: 'api:ui:notify:action',
                                    payload: {
                                        requestId,
                                        pluginId,
                                        actionId: spec.id,
                                        notificationId,
                                        message: parsed.message,
                                        type: parsed.type,
                                    },
                                });
                                void wait
                                    .then((result) => {
                                        if (!runtimeSupervisor.current.isCurrentWorker(pluginId, worker)) return;
                                        if (!result.ok) {
                                            notify.error(result.error || 'Plugin action failed', {
                                                source: `plugin:${pluginId}`,
                                                history: true,
                                            });
                                            return;
                                        }
                                        if (dismissOnSuccess && notificationId) {
                                            useAppStore.getState().removeNotification(notificationId);
                                        }
                                    })
                                    .catch((error: unknown) => {
                                        if (!runtimeSupervisor.current.isCurrentWorker(pluginId, worker)) return;
                                        const message = error instanceof Error
                                            ? error.message
                                            : 'Plugin action failed';
                                        notify.error(message, {
                                            source: `plugin:${pluginId}`,
                                            history: true,
                                        });
                                    })
                                    .finally(() => {
                                        pluginNotifyActionsInFlight.delete(flightKey);
                                    });
                            },
                        };
                    });
                }
                notify.emit(parsed.type, parsed.message, options);
                respond(requester, pluginId, type, { requestId, result: { ok: true } });
                break;
            }
            case 'api:ui:notify:action:response': {
                resolvePluginNotifyActionResponse(payload);
                break;
            }
            case 'api:ui:confirm': {
                const runtimeInstanceId = runtimeSupervisor.current.getRuntimeInstanceId(pluginId);
                const requestId = payload?.requestId;
                try {
                    if (!runtimeInstanceId) throw new Error('Plugin runtime is not registered');
                    await authorizePluginCapability(runtimeInstanceId, 'ui.dialog.confirm');
                    if (
                        !runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                        || !runtimeSupervisor.current.isCurrentRuntime(pluginId, runtimeInstanceId)
                    ) break;
                    const confirmed = await useAppStore.getState().showConfirmDialog(
                        normalizePluginConfirmRequest(payload),
                    );
                    if (!runtimeSupervisor.current.isCurrentWorker(pluginId, requester)) break;
                    respond(requester, pluginId, type, { requestId, result: confirmed });
                } catch (error) {
                    if (!runtimeSupervisor.current.isCurrentWorker(pluginId, requester)) break;
                    respond(requester, pluginId, type, {
                        requestId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                break;
            }
            case 'api:statusbar:set':
                window.dispatchEvent(new CustomEvent('zync:statusbar:set', { detail: { id: payload.id, text: payload.text } }));
                break;
            case 'api:log':
                console.log(`[Plugin Log]`, payload);
                break;
            case 'api:commands:register': {
                const runtimeInstanceId = runtimeSupervisor.current.getRuntimeInstanceId(pluginId);
                const requestId = payload?.requestId;
                if (!runtimeInstanceId) {
                    respond(requester, pluginId, type, {
                        requestId,
                        error: 'Plugin runtime is not registered',
                    });
                    break;
                }
                try {
                    await authorizePluginCommandRegistration(
                        runtimeInstanceId,
                        payload?.id,
                        payload?.title,
                    );
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    respond(requester, pluginId, type, { requestId, error: message });
                    break;
                }
                if (
                    !runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                    || !runtimeSupervisor.current.isCurrentRuntime(pluginId, runtimeInstanceId)
                ) break;
                setCommands(prev => {
                    if (prev.some(cmd => cmd.id === payload.id)) return prev;
                    return [...prev, {
                        id: payload.id,
                        title: payload.title,
                        pluginId
                    }];
                });
                respond(requester, pluginId, type, { requestId, result: { ok: true } });
                break;
            }
            case 'api:theme:set':
                console.log('[PluginContext] Theme set requested:', payload.theme);
                useAppStore.getState().updateSettings({ theme: payload.theme });
                notify.success(`Theme changed to ${payload.theme}`, { source: `plugin:${pluginId}` });
                break;
            case 'api:window:showQuickPick':
                // Dispatch event for CommandPalette to handle
                window.dispatchEvent(new CustomEvent('zync:quick-pick', {
                    detail: {
                        items: pluginId === 'com.zync.theme.manager'
                            ? filterTrustedBuiltinThemeChoices(payload.items, trustedBuiltinThemes.current)
                            : payload.items,
                        options: payload.options,
                        requestId: payload.requestId,
                        pluginId,
                        requester,
                    }
                }));
                break;
            case 'api:plugins:load':
                try {
                    const list = await ipcRenderer.invoke('plugins:load');
                    respond(requester, pluginId, 'api:plugins:load', {
                        requestId: payload.requestId,
                        result: filterUnsupportedHostThemes(list)
                    });
                } catch (e) {
                    console.error('[PluginContext] Failed to load plugins for worker:', e);
                    respond(requester, pluginId, 'api:plugins:load', {
                        requestId: payload.requestId,
                        result: [],
                        error: String(e)
                    });
                }
                break;

            case 'api:storage:get':
            case 'api:storage:keys':
            case 'api:storage:set':
            case 'api:storage:delete': {
                const runtimeInstanceId = runtimeSupervisor.current.getRuntimeInstanceId(pluginId);
                const requestId = payload?.requestId;
                if (!runtimeInstanceId) {
                    respond(requester, pluginId, type, {
                        requestId,
                        error: 'Plugin runtime is not registered',
                    });
                    break;
                }
                try {
                    let result: unknown;
                    if (type === 'api:storage:get') {
                        result = await getPluginStorageValue(runtimeInstanceId, payload?.key);
                    } else if (type === 'api:storage:keys') {
                        result = await listPluginStorageKeys(runtimeInstanceId);
                    } else if (type === 'api:storage:set') {
                        await setPluginStorageValue(runtimeInstanceId, payload?.key, payload?.value);
                        result = true;
                    } else {
                        result = await deletePluginStorageValue(runtimeInstanceId, payload?.key);
                    }
                    if (
                        !runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                        || !runtimeSupervisor.current.isCurrentRuntime(pluginId, runtimeInstanceId)
                    ) break;
                    respond(requester, pluginId, type, { requestId, result });
                } catch (error) {
                    if (
                        !runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                        || !runtimeSupervisor.current.isCurrentRuntime(pluginId, runtimeInstanceId)
                    ) break;
                    const message = error instanceof Error ? error.message : String(error);
                    respond(requester, pluginId, type, { requestId, error: message });
                }
                break;
            }

            case 'api:network:fetch': {
                const runtimeInstanceId = runtimeSupervisor.current.getRuntimeInstanceId(pluginId);
                const requestId = payload?.requestId;
                if (!runtimeInstanceId) {
                    respond(requester, pluginId, type, {
                        requestId,
                        error: 'Plugin runtime is not registered',
                    });
                    break;
                }
                try {
                    const result = await fetchPluginNetworkResource(runtimeInstanceId, {
                        url: payload?.url,
                        accept: payload?.accept,
                    });
                    if (
                        !runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                        || !runtimeSupervisor.current.isCurrentRuntime(pluginId, runtimeInstanceId)
                    ) break;
                    respond(requester, pluginId, type, { requestId, result });
                } catch (error) {
                    if (
                        !runtimeSupervisor.current.isCurrentWorker(pluginId, requester)
                        || !runtimeSupervisor.current.isCurrentRuntime(pluginId, runtimeInstanceId)
                    ) break;
                    const message = error instanceof Error ? error.message : String(error);
                    respond(requester, pluginId, type, { requestId, error: message });
                }
                break;
            }

            // File System Bridge
            case 'api:fs:read':
                try {
                    const content = await ipcRenderer.invoke('plugin_fs_read', { path: payload.path });
                    respond(requester, pluginId, type, { requestId: payload.requestId, result: content });
                } catch (e: any) {
                    respond(requester, pluginId, type, { requestId: payload.requestId, error: e.toString() });
                }
                break;
            case 'api:fs:write':
                try {
                    await ipcRenderer.invoke('plugin_fs_write', { path: payload.path, content: payload.content });
                    respond(requester, pluginId, type, { requestId: payload.requestId, result: true });
                } catch (e: any) {
                    respond(requester, pluginId, type, { requestId: payload.requestId, error: e.toString() });
                }
                break;
            case 'api:fs:list':
                try {
                    const entries = await ipcRenderer.invoke('plugin_fs_list', { path: payload.path });
                    respond(requester, pluginId, type, { requestId: payload.requestId, result: entries });
                } catch (e: any) {
                    respond(requester, pluginId, type, { requestId: payload.requestId, error: e.toString() });
                }
                break;
            case 'api:fs:exists':
                try {
                    const exists = await ipcRenderer.invoke('plugin_fs_exists', { path: payload.path });
                    respond(requester, pluginId, type, { requestId: payload.requestId, result: exists });
                } catch (e: any) {
                    respond(requester, pluginId, type, { requestId: payload.requestId, error: e.toString() });
                }
                break;
            case 'api:fs:mkdir':
                try {
                    await ipcRenderer.invoke('plugin_fs_create_dir', { path: payload.path });
                    respond(requester, pluginId, type, { requestId: payload.requestId, result: true });
                } catch (e: any) {
                    respond(requester, pluginId, type, { requestId: payload.requestId, error: e.toString() });
                }
                break;
        }
    };

    const executeCommand = (id: string) => {
        const cmd = commands.find(c => c.id === id);
        if (!cmd) return;

        const worker = runtimeSupervisor.current.getWorker(cmd.pluginId);
        if (worker) {
            worker.postMessage({ type: 'command:execute', payload: { id } });
        }
    };
    reloadPluginsRef.current = reloadPlugins;

    const retryPluginRuntime = async (pluginId: string): Promise<boolean> => {
        try {
            const health = runtimeSupervisor.current.snapshot().find(item => item.pluginId === pluginId);
            if (health?.status === 'quarantined') {
                await clearNativePluginRuntimeFailures(pluginId);
                runtimeSupervisor.current.clearQuarantine(pluginId);
            }
            return reloadPlugins();
        } catch (error) {
            console.error(`[Plugins] Failed to retry ${pluginId}:`, error);
            return false;
        }
    };

    const exitPluginSafeMode = async (): Promise<boolean> => {
        try {
            await clearNativePluginSafeMode();
            setPluginSafeMode(false);
            return reloadPlugins();
        } catch (error) {
            console.error('[Plugins] Failed to leave safe mode:', error);
            return false;
        }
    };

    const postPaneMessage = useCallback((pluginId: string, panelId: string, paneInstanceId: string, message: unknown): boolean => {
        const worker = runtimeSupervisor.current.getWorker(pluginId);
        if (!worker) return false;
        worker.postMessage({
            type: 'pane:message',
            payload: { panelId, paneInstanceId, message },
        });
        return true;
    }, [cleanUpFailedRuntime]);

    const registerPaneMessageTarget = useCallback((
        pluginId: string,
        panelId: string,
        paneInstanceId: string,
        connectionId: string,
        post: (message: unknown) => void,
    ) => {
        const key = `${pluginId}\0${paneInstanceId}`;
        const target = { panelId, post };
        paneMessageTargets.current.set(key, target);
        const runtimeInstanceId = runtimeSupervisor.current.getRuntimeInstanceId(pluginId);
        if (runtimeInstanceId) {
            void paneBindingQueue.current.enqueue(key, () => bindNativePluginPaneConnection(
                runtimeInstanceId,
                panelId,
                paneInstanceId,
                connectionId,
            )).catch(error => console.error('[Plugins] Failed to bind pane connection:', error));
        }
        return () => {
            if (paneMessageTargets.current.get(key) === target) {
                paneMessageTargets.current.delete(key);
                if (runtimeInstanceId) {
                    void paneBindingQueue.current.enqueue(key, () => (
                        unbindNativePluginPaneConnection(runtimeInstanceId, paneInstanceId)
                    )).catch(error => {
                        console.error('[Plugins] Failed to unbind pane connection:', error);
                    });
                }
            }
        };
    }, []);

    // Listen for Quick Pick selections from UI
    useEffect(() => {
        const handleQuickPickSelect = (e: any) => {
            const { requestId, pluginId, selectedItem, requester = runtimeSupervisor.current.getWorker(pluginId) } = e.detail;
            if (!requester) return;
            postCurrentWorkerResponse(
                requester,
                (candidate: Worker) => runtimeSupervisor.current.isCurrentWorker(pluginId, candidate),
                'api:window:showQuickPick',
                { requestId, result: selectedItem },
            );
        };

        window.addEventListener('zync:quick-pick-select', handleQuickPickSelect);
        return () => window.removeEventListener('zync:quick-pick-select', handleQuickPickSelect);
    }, []);

    return (
        <PluginContext.Provider value={{
            plugins,
            editorProviders,
            loaded,
            commands,
            panels,
            runtimeHealth,
            pluginSafeMode,
            executeCommand,
            reloadPlugins,
            retryPluginRuntime,
            exitPluginSafeMode,
            postPaneMessage,
            registerPaneMessageTarget,
        }}>
            {children}
        </PluginContext.Provider>
    );
};
