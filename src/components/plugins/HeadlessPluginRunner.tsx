import { useEffect, useRef } from 'react';
import { usePlugins } from '../../context/PluginContext';

const EMPTY_PERMISSIONS: string[] = [];

function HeadlessIframe({ pluginId, permissions = EMPTY_PERMISSIONS }: { pluginId: string, permissions?: string[] }) {
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        const hasPermission = (token: string): boolean => permissions.includes(token);
        
        const denyPermission = (token: string, msgType: string) => {
            console.warn(`[Zync Headless] Plugin "${pluginId}" blocked. Missing permission "${token}" for "${msgType}".`);
        };

        const handler = (e: MessageEvent) => {
            if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
            const { type, payload } = e.data || {};
            if (!type) return;

            // Simplified bridge for headless plugins
            if (type === 'zync:ui:notify') {
                if (!hasPermission('ui:notify')) return denyPermission('ui:notify', type);
                window.dispatchEvent(new CustomEvent('zync:ui:notify', { detail: payload }));
            }
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [pluginId, permissions]);

    return (
        <iframe
            ref={iframeRef}
            src={`plugin://${pluginId}/index.html`}
            style={{ display: 'none', width: 0, height: 0, border: 'none' }}
            sandbox="allow-scripts"
            title={`Headless Plugin: ${pluginId}`}
        />
    );
}

export function HeadlessPluginRunner() {
    const { plugins } = usePlugins();
    
    // Filter for headless plugins with a rigorous type guard for safety
    const headlessPlugins = (plugins ?? []).filter(
        (p): p is typeof p & { manifest: { id: string; type: 'headless'; permissions?: string[] } } =>
            p.manifest?.type === 'headless' && typeof p.manifest?.id === 'string'
    );

    if (headlessPlugins.length === 0) return null;

    return (
        <div id="zync-headless-runner" style={{ display: 'none' }}>
            {headlessPlugins.map(plugin => (
                <HeadlessIframe 
                    key={plugin.manifest.id} 
                    pluginId={plugin.manifest.id} 
                    permissions={plugin.manifest.permissions} 
                />
            ))}
        </div>
    );
}

