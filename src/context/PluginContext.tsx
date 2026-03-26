import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ipcRenderer } from '../lib/tauri-ipc';
import { useAppStore } from '../store/useAppStore';

interface Plugin {
    path: string;
    manifest: {
        id: string;
        name: string;
        version: string;
        type?: string;
        permissions?: string[];
        main?: string;
        style?: string;
        mode?: string;
        preview_bg?: string;
        preview_accent?: string;
        icon?: string;
    };
    script?: string;
    style?: string;
    enabled: boolean;
}

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
}

interface PluginContextType {
    plugins: Plugin[];
    loaded: boolean;
    commands: PluginCommand[];
    panels: PluginPanel[];
    executeCommand: (id: string) => void;
    loadPlugins: () => Promise<void>;
}

const PluginContext = createContext<PluginContextType>({
    plugins: [],
    loaded: false,
    commands: [],
    panels: [],
    executeCommand: () => { },
    loadPlugins: async () => {},
});

export const usePlugins = () => useContext(PluginContext);

const WORKER_BOOTSTRAP = `
class PermissionError extends Error {
    constructor(permission, apiIdentifier) {
        super(\`Access denied: Missing permission "\${permission}" for "\${apiIdentifier}"\`);
        this.name = 'PermissionError';
        this.permission = permission;
        this.apiIdentifier = apiIdentifier;
    }
}

const zync = {
    callbacks: {},
    commandHandlers: {},
    pendingRequests: {},
    
    on: (event, callback) => {
        if (!zync.callbacks[event]) zync.callbacks[event] = [];
        zync.callbacks[event].push(callback);
    },

    emit: (event, data) => {
        if (zync.callbacks[event]) {
            zync.callbacks[event].forEach(cb => cb(data));
        }
    },

    request: (type, payload) => {
        return new Promise((resolve, reject) => {
             const requestId = crypto.randomUUID();
             zync.pendingRequests[requestId] = { resolve, reject };
             self.postMessage({ type, payload: { ...payload, requestId } });
        });
    },

    ui: {
        notify: (opts) => self.postMessage({ type: 'api:ui:notify', payload: opts }),
        confirm: (opts) => zync.request('api:ui:confirm', opts)
    },

    fs: {
        readTextFile: (path) => zync.request('api:fs:read', { path }),
        writeTextFile: (path, content) => zync.request('api:fs:write', { path, content }),
        readDir: (path) => zync.request('api:fs:list', { path }),
        exists: (path) => zync.request('api:fs:exists', { path }),
        mkdir: (path) => zync.request('api:fs:mkdir', { path }),
    },

    ssh: {
        exec: (command) => zync.request('api:ssh:exec', { command }),
    },

    terminal: {
        send: (text) => self.postMessage({ type: 'api:terminal:send', payload: { text } }),
        newTab: (opts) => zync.request('api:terminal:opentab', opts)
    },

    statusBar: {
        set: (id, text) => self.postMessage({ type: 'api:statusbar:set', payload: { id, text } })
    },

    theme: {
        set: (theme) => zync.request('api:theme:set', { theme })
    },

    window: {
        create: (opts) => zync.request('api:window:create', opts),
        showQuickPick: (items, options) => zync.request('api:window:showQuickPick', { items, options })
    }
};

self.onmessage = async (e) => {
    const { type, payload } = e.data || {};
    if (!type) return;

    if (type.endsWith(':response')) {
        const { requestId, result, error } = payload || {};
        const handler = zync.pendingRequests[requestId];
        if (handler) {
            if (error) handler.reject(new Error(error));
            else handler.resolve(result);
            delete zync.pendingRequests[requestId];
        }
    } else if (type === 'api:error:permission') {
        const { requestId, permission, apiIdentifier } = payload || {};
        const handler = zync.pendingRequests[requestId];
        if (handler) {
            handler.reject(new PermissionError(permission, apiIdentifier));
            delete zync.pendingRequests[requestId];
        }
    } else if (type === 'init') {
        zync.emit('ready');
    } else if (type === 'command:execute') {
        const handler = zync.commandHandlers[payload.id];
        if (handler) await handler();
    }
};

self.zync = zync;
`;

export const PluginProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [commands, setCommands] = useState<PluginCommand[]>([]);
    const [panels, setPanels] = useState<PluginPanel[]>([]);
    const workers = useRef<Map<string, Worker>>(new Map());
    const pluginsRef = useRef<Plugin[]>([]);
    const showToast = useAppStore(state => state.showToast);

    // Sync ref with state to avoid stale closures in worker handlers
    useEffect(() => {
        pluginsRef.current = plugins;
    }, [plugins]);

    const respond = (pluginId: string, type: string, payload: any) => {
        const worker = workers.current.get(pluginId);
        if (worker) worker.postMessage({ type: `${type}:response`, payload });
    };

    const checkPermission = (pluginId: string, permission: string, requestId?: string) => {
        const plugin = pluginsRef.current.find(p => p.manifest.id === pluginId);
        if (!plugin) return false;
        const approved = plugin.manifest.permissions || [];
        if (approved.includes(permission) || approved.includes(`${permission.split(':')[0]}:*`)) return true;

        console.warn(`[Zync Security] Permission denied: '${permission}' for '${pluginId}'`);
        showToast('error', `Plugin '${plugin.manifest.name}' blocked: missing '${permission}'`);

        if (requestId) {
            const worker = workers.current.get(pluginId);
            worker?.postMessage({
                type: 'api:error:permission',
                payload: { requestId, permission, apiIdentifier: `zync.${permission.replace(':', '.')}` }
            });
        }
        return false;
    };

    const handlePluginMessage = async (pluginId: string, type: string, payload: any) => {
        switch (type) {
            case 'api:ui:notify':
                showToast(payload.type || 'info', payload.message || 'Notification');
                break;
            case 'api:ui:confirm':
                const confirmed = await useAppStore.getState().showConfirmDialog(payload);
                respond(pluginId, type, { requestId: payload.requestId, result: confirmed });
                break;
            case 'api:terminal:send':
                if (!checkPermission(pluginId, 'terminal:write', payload.requestId)) return;
                window.dispatchEvent(new CustomEvent('zync:terminal:send', { detail: { text: payload.text } }));
                break;
            case 'api:terminal:opentab':
                if (!checkPermission(pluginId, 'terminal:newtab', payload.requestId)) return;
                window.dispatchEvent(new CustomEvent('ssh-ui:new-terminal-tab', { detail: payload }));
                break;
            case 'api:ssh:exec':
                if (!checkPermission(pluginId, 'ssh:exec', payload.requestId)) return;
                try {
                    const connId = useAppStore.getState().activeConnectionId;
                    const result = await ipcRenderer.invoke('ssh_exec', { connectionId: connId, command: payload.command });
                    respond(pluginId, type, { requestId: payload.requestId, result });
                } catch (e: any) {
                    respond(pluginId, type, { requestId: payload.requestId, error: e.toString() });
                }
                break;
            case 'api:fs:read':
                if (!checkPermission(pluginId, 'fs:read', payload.requestId)) return;
                ipcRenderer.invoke('plugin_fs_read', { path: payload.path })
                    .then(res => respond(pluginId, type, { requestId: payload.requestId, result: res }))
                    .catch(e => respond(pluginId, type, { requestId: payload.requestId, error: e.toString() }));
                break;
            case 'api:fs:write':
                if (!checkPermission(pluginId, 'fs:write', payload.requestId)) return;
                ipcRenderer.invoke('plugin_fs_write', { path: payload.path, content: payload.content })
                    .then(() => respond(pluginId, type, { requestId: payload.requestId, result: true }))
                    .catch(e => respond(pluginId, type, { requestId: payload.requestId, error: e.toString() }));
                break;
            case 'api:fs:list':
                if (!checkPermission(pluginId, 'fs:read', payload.requestId)) return;
                ipcRenderer.invoke('plugin_fs_list', { path: payload.path })
                    .then(res => respond(pluginId, type, { requestId: payload.requestId, result: res }))
                    .catch(e => respond(pluginId, type, { requestId: payload.requestId, error: e.toString() }));
                break;
            case 'api:theme:set':
                if (!checkPermission(pluginId, 'theme:set', payload.requestId)) return;
                useAppStore.getState().updateSettings({ theme: payload.theme });
                respond(pluginId, type, { requestId: payload.requestId, result: true });
                break;
            case 'api:window:create':
                if (!checkPermission(pluginId, 'window:create', payload.requestId)) return;
                ipcRenderer.invoke('plugin_window_create', payload)
                    .then(() => respond(pluginId, type, { requestId: payload.requestId, result: true }))
                    .catch(e => respond(pluginId, type, { requestId: payload.requestId, error: e.toString() }));
                break;
            case 'api:commands:register':
                setCommands(prev => [...prev.filter(c => c.id !== payload.id), { ...payload, pluginId }]);
                break;
            case 'api:panel:register':
                setPanels(prev => [...prev.filter(p => p.id !== payload.id), { ...payload, pluginId }]);
                break;
            case 'api:window:showQuickPick':
                window.dispatchEvent(new CustomEvent('zync:quick-pick', { detail: { ...payload, pluginId } }));
                break;
            default:
                console.warn('[PluginContext] Unknown message:', type);
        }
    };

    const loadPlugins = async () => {
        try {
            const list: Plugin[] = await ipcRenderer.invoke('plugins_load');
            setPlugins(list);
            list.filter(p => (p.script && p.enabled)).forEach(p => {
                const blob = new Blob([WORKER_BOOTSTRAP, '\n\n// USER SCRIPT START\n\n', p.script!], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                const worker = new Worker(url);
                URL.revokeObjectURL(url);
                worker.onmessage = (e) => handlePluginMessage(p.manifest.id, e.data.type, e.data.payload);
                worker.postMessage({ type: 'init' });
                workers.current.set(p.manifest.id, worker);
            });
            setLoaded(true);
        } catch (e) {
            console.error('[Plugins] Load failed:', e);
        }
    };

    const executeCommand = (id: string) => {
        const cmd = commands.find(c => c.id === id);
        if (cmd) workers.current.get(cmd.pluginId)?.postMessage({ type: 'command:execute', payload: { id } });
    };

    useEffect(() => {
        loadPlugins();
        const qp = (e: any) => respond(e.detail.pluginId, 'api:window:showQuickPick', { requestId: e.detail.requestId, result: e.detail.selectedItem });
        window.addEventListener('zync:quick-pick-select', qp);
        return () => { 
            window.removeEventListener('zync:quick-pick-select', qp); 
            workers.current.forEach(w => w.terminate()); 
        };
    }, []);

    return (
        <PluginContext.Provider value={{ plugins, loaded, commands, panels, executeCommand, loadPlugins }}>
            {children}
        </PluginContext.Provider>
    );
};
