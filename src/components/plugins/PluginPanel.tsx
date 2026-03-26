import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';

interface PluginPanelProps {
    panelId: string;
    pluginId: string;
    connectionId: string | null;
    /** Declared permissions from the plugin's manifest.json */
    permissions?: string[];
}

/**
 * Renders a plugin panel inside a sandboxed iframe.
 * Provides a postMessage bridge so the panel can still call zync.terminal.send(), etc.
 *
 * Security: All bridge calls are gated by the plugin's declared permissions.
 * The iframe runs without allow-same-origin to prevent accessing the raw Tauri IPC.
 */
const EMPTY_PERMISSIONS: string[] = [];

export function PluginPanel({ panelId, pluginId, connectionId, permissions = EMPTY_PERMISSIONS }: PluginPanelProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const theme = useAppStore(s => s.settings.theme);

    // Robustness: Stabilize permissions reference even if parent passes a new array literal
    const stablePermissions = useMemo(() => permissions, [JSON.stringify(permissions)]);

    const sendTheme = useCallback(() => {
        if (!iframeRef.current || !iframeRef.current.contentWindow) return;
        const computed = getComputedStyle(document.documentElement);
        const colors = {
            background: computed.getPropertyValue('--app-bg').trim() || '#0f111a',
            surface: computed.getPropertyValue('--app-surface').trim() || '#1a1d2e',
            border: computed.getPropertyValue('--app-border').trim() || 'rgba(255,255,255,0.08)',
            text: computed.getPropertyValue('--app-text').trim() || '#e2e8f0',
            muted: computed.getPropertyValue('--app-muted').trim() || '#94a3b8',
            primary: computed.getPropertyValue('--app-accent').trim() || '#6366f1',
        };
        iframeRef.current.contentWindow.postMessage({
            type: 'zync:theme:update',
            payload: { theme, colors }
        }, '*');
    }, [theme]);

    // Broadcast theme changes to the iframe
    useEffect(() => {
        sendTheme();
    }, [sendTheme]);

    // Listen for messages FROM the iframe (plugin panel calling zync.*)
    useEffect(() => {
        /** Returns true if the plugin has declared the given permission token. */
        const hasPermission = (token: string): boolean => stablePermissions.includes(token);

        /** Sends an explicit PermissionError to the plugin so it can reject the calling Promise. */
        const denyPermission = (token: string, apiIdentifier: string, requestId?: string) => {
            console.warn(
                `[Zync Security] Plugin "${pluginId}" blocked. Missing permission "${token}" for "${apiIdentifier}".`
            );
            if (requestId) {
                iframeRef.current?.contentWindow?.postMessage({
                    type: 'zync:error:permission',
                    payload: { requestId, permission: token, apiIdentifier }
                }, '*');
            }
        };

        const handler = (e: MessageEvent) => {
            if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
            const { type, payload } = e.data || {};
            if (!type) return;

            if (type === 'zync:terminal:send') {
                if (!hasPermission('terminal:write')) {
                    denyPermission('terminal:write', 'zync.terminal.send', payload.requestId);
                    return;
                }
                window.dispatchEvent(new CustomEvent('zync:terminal:send', { detail: { text: payload.text, connectionId } }));

            } else if (type === 'zync:terminal:opentab') {
                if (!hasPermission('terminal:newtab')) {
                    denyPermission('terminal:newtab', 'zync.terminal.newTab', payload.requestId);
                    return;
                }
                window.dispatchEvent(new CustomEvent('ssh-ui:new-terminal-tab', { detail: { connectionId, command: payload.command } }));

            } else if (type === 'zync:statusbar:set') {
                if (!hasPermission('statusbar:write')) {
                    denyPermission('statusbar:write', 'zync.statusBar.set', payload.requestId);
                    return;
                }
                window.dispatchEvent(new CustomEvent('zync:statusbar:set', { detail: payload }));

            } else if (type === 'zync:ui:notify') {
                if (!hasPermission('ui:notify')) {
                    denyPermission('ui:notify', 'zync.ui.notify', payload.requestId);
                    return;
                }
                window.dispatchEvent(new CustomEvent('zync:ui:notify', { detail: payload }));

            } else if (type === 'zync:ui:confirm') {
                if (!hasPermission('ui:confirm')) {
                    denyPermission('ui:confirm', 'zync.ui.confirm', payload.requestId);
                    return;
                }
                import('../../store/useAppStore').then(({ useAppStore }) => {
                    useAppStore.getState().showConfirmDialog({
                        title: payload.title || 'Confirm',
                        message: payload.message || 'Are you sure?',
                        confirmText: payload.confirmText,
                        cancelText: payload.cancelText,
                        variant: payload.variant
                    }).then((confirmed) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: 'zync:ui:confirm:response',
                            payload: { requestId: payload.requestId, confirmed }
                        }, '*');
                    });
                });

            } else if (type === 'zync:ssh:exec') {
                if (!hasPermission('ssh:exec')) {
                    denyPermission('ssh:exec', 'zync.ssh.exec', payload.requestId);
                    return;
                }
                if (!connectionId) {
                    iframeRef.current?.contentWindow?.postMessage({
                        type: 'zync:ssh:exec:response',
                        payload: { requestId: payload.requestId, error: 'No active connection' }
                    }, '*');
                    return;
                }
                import('../../lib/tauri-ipc').then(({ ipcRenderer }) => {
                    ipcRenderer.invoke('ssh_exec', { connectionId, command: payload.command })
                        .then(result => {
                            iframeRef.current?.contentWindow?.postMessage({
                                type: 'zync:ssh:exec:response',
                                payload: { requestId: payload.requestId, result }
                            }, '*');
                        })
                        .catch(error => {
                            iframeRef.current?.contentWindow?.postMessage({
                                type: 'zync:ssh:exec:response',
                                payload: { requestId: payload.requestId, error: String(error) }
                            }, '*');
                        });
                });
            } else if (type === 'zync:fs:readTextFile') {
                if (!hasPermission('fs:read')) {
                    denyPermission('fs:read', 'zync.fs.readTextFile', payload.requestId);
                    return;
                }
                if (!connectionId) {
                    iframeRef.current?.contentWindow?.postMessage({ type: 'zync:fs:readTextFile:response', payload: { requestId: payload.requestId, error: 'No active connection' } }, '*');
                    return;
                }
                import('../../lib/tauri-ipc').then(({ ipcRenderer }) => {
                    ipcRenderer.invoke('fs_read_file', { connectionId, path: payload.path })
                        .then(result => iframeRef.current?.contentWindow?.postMessage({ type: 'zync:fs:readTextFile:response', payload: { requestId: payload.requestId, result } }, '*'))
                        .catch(error => iframeRef.current?.contentWindow?.postMessage({ type: 'zync:fs:readTextFile:response', payload: { requestId: payload.requestId, error: String(error) } }, '*'));
                });
            } else if (type === 'zync:fs:writeTextFile') {
                if (!hasPermission('fs:write')) {
                    denyPermission('fs:write', 'zync.fs.writeTextFile', payload.requestId);
                    return;
                }
                if (!connectionId) {
                    iframeRef.current?.contentWindow?.postMessage({ type: 'zync:fs:writeTextFile:response', payload: { requestId: payload.requestId, error: 'No active connection' } }, '*');
                    return;
                }
                import('../../lib/tauri-ipc').then(({ ipcRenderer }) => {
                    ipcRenderer.invoke('fs_write_file', { connectionId, path: payload.path, content: payload.content })
                        .then(() => iframeRef.current?.contentWindow?.postMessage({ type: 'zync:fs:writeTextFile:response', payload: { requestId: payload.requestId } }, '*'))
                        .catch(error => iframeRef.current?.contentWindow?.postMessage({ type: 'zync:fs:writeTextFile:response', payload: { requestId: payload.requestId, error: String(error) } }, '*'));
                });
            } else if (type === 'zync:fs:readDir') {
                if (!hasPermission('fs:read')) {
                    denyPermission('fs:read', 'zync.fs.readDir', payload.requestId);
                    return;
                }
                if (!connectionId) {
                    iframeRef.current?.contentWindow?.postMessage({ type: 'zync:fs:readDir:response', payload: { requestId: payload.requestId, error: 'No active connection' } }, '*');
                    return;
                }
                import('../../lib/tauri-ipc').then(({ ipcRenderer }) => {
                    ipcRenderer.invoke('fs_list', { connectionId, path: payload.path })
                        .then(result => {
                            const rawList = Array.isArray(result.children || result) ? (result.children || result) : [];
                            const formattedList = rawList.map((item: any) => {
                                const date = new Date(item.modified);
                                return {
                                    ...item,
                                    modified: (!isNaN(date.getTime())) ? date.toISOString() : null
                                };
                            });
                            iframeRef.current?.contentWindow?.postMessage({ 
                                type: 'zync:fs:readDir:response', 
                                payload: { requestId: payload.requestId, result: formattedList } 
                            }, '*');
                        })
                        .catch(error => iframeRef.current?.contentWindow?.postMessage({ type: 'zync:fs:readDir:response', payload: { requestId: payload.requestId, error: String(error) } }, '*'));
                });
            } else if (type === 'zync:theme:set') {
                if (!hasPermission('theme:set')) {
                    denyPermission('theme:set', 'zync.theme.set', payload.requestId);
                    return;
                }
                // ... Theme setting implementation ...
            } else if (type === 'zync:window:create') {
                if (!hasPermission('window:create')) {
                    denyPermission('window:create', 'zync.window.create', payload.requestId);
                    return;
                }
                // ... Window creation implementation ...
            }
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [pluginId, connectionId, stablePermissions]);
    return (
        <div className="absolute inset-0 z-10 bg-app-bg flex flex-col">
            <iframe
                ref={iframeRef}
                src={`plugin://${pluginId}/index.html`}
                onLoad={sendTheme}
                // Security: origin isolation is strictly enforced by the custom plugin:// protocol.
                // allow-same-origin is safely omitted.
                sandbox="allow-scripts allow-modals"
                className="flex-1 w-full border-0 bg-transparent"
                title={`Plugin Panel: ${panelId}`}
            />
        </div>
    );
}
