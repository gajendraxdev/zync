import { useState, type ReactNode } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Plug } from 'lucide-react';
import { pluginIconPath } from '../../features/plugins/pluginIconPath';

interface Props { icon?: string; pluginPath?: string; size?: number; className?: string; fallback?: ReactNode }

function AssetImage({ src, size, className, fallback }: { src: string; size: number; className?: string; fallback?: ReactNode }) {
    const [failed, setFailed] = useState(false);
    if (failed) return fallback ?? <Plug size={size} className={className} aria-hidden />;
    // An image document cannot inject plugin markup into the host React tree.
    return <img src={src} width={size} height={size} alt="" aria-hidden="true" className={className}
        style={{ flexShrink: 0, objectFit: 'contain' }} onError={() => setFailed(true)} />;
}

export function PluginAssetIcon({ icon, pluginPath, size = 14, className, fallback }: Props) {
    const path = pluginIconPath(pluginPath, icon);
    let src: string | undefined;
    if (path) {
        try { src = convertFileSrc(path); } catch { /* Asset transport is unavailable outside Tauri. */ }
    }
    return src ? <AssetImage key={src} src={src} size={size} className={className} fallback={fallback} />
        : fallback ?? <Plug size={size} className={className} aria-hidden />;
}
