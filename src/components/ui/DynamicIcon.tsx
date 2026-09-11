import { memo, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  ensureThemedIcon,
  fileTypeIconID,
  getThemedIconEntry,
  markThemedIconMissing,
  subscribeThemedIcon,
  themedIconKey,
} from '../../lib/icons/themedIconSrc';
import { Server, File, Folder, Terminal, Settings, Lock, FileCode, Archive, Database, Image } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';
import { usePlugins } from '../../context/PluginContext';

interface DynamicIconProps {
    type: string;
    size?: number;
    className?: string;
    isFolder?: boolean;
}

function lucideFallback(type: string, isFolder: boolean): ComponentType<{ size?: number; className?: string }> {
    if (isFolder) return Folder;
    if (type === 'connection') return Server;
    const lower = type.toLowerCase();
    if (lower.startsWith('.') || ['sh', 'bash', 'zsh', 'fish', 'ps1'].includes(lower)) return Terminal;
    if (
        lower.includes('config')
        || ['yml', 'yaml', 'toml', 'ini', 'json'].includes(lower)
        || ['exe', 'msi', 'apk', 'appimage', 'bin', 'iso', 'img', 'dll', 'so'].includes(lower)
    ) return Settings;
    if (lower.includes('key') || lower.includes('id_') || ['pem', 'pub', 'key', 'crt'].includes(lower)) return Lock;
    if (['zip', 'tar', 'gz', 'rar', '7z'].includes(lower)) return Archive;
    if (['db', 'sqlite', 'sql'].includes(lower)) return Database;
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(lower)) return Image;
    if (['js', 'ts', 'py', 'go', 'rs', 'c', 'cpp'].includes(lower)) return FileCode;
    return File;
}

export const DynamicIcon = memo(function DynamicIcon({
    type,
    size = 14,
    className,
    isFolder = false,
}: DynamicIconProps) {
    const iconTheme = useAppStore((s) => s.settings.iconTheme);
    const { plugins } = usePlugins();

    const activePlugin = useMemo(() => {
        if (iconTheme === 'vscode-icons' || iconTheme === 'lucide') return null;
        return plugins.find((p) => p.manifest.id === iconTheme && p.manifest.type === 'icon-theme');
    }, [iconTheme, plugins]);

    const iconID = fileTypeIconID(type, isFolder, iconTheme);
    const pluginId = activePlugin?.manifest.id ?? '';
    const key = themedIconKey(iconTheme, iconID, pluginId);
    const pluginIconsPath = activePlugin?.manifest?.iconsPath
        ?? (activePlugin?.manifest as { icons_path?: string } | undefined)?.icons_path;

    const [, setEpoch] = useState(0);
    const cached = iconTheme === 'lucide' ? { status: 'missing' as const } : getThemedIconEntry(key);

    useEffect(() => {
        if (iconTheme === 'lucide') return;
        const unsub = subscribeThemedIcon(key, () => setEpoch((n) => n + 1));
        ensureThemedIcon(key, iconID, iconTheme, activePlugin?.path, pluginIconsPath);
        return unsub;
    }, [activePlugin?.path, iconID, iconTheme, key, pluginIconsPath]);

    const src = cached?.status === 'ready' ? cached.src : null;
    const showFallback = iconTheme === 'lucide' || cached?.status !== 'ready';
    const FallbackIcon = useMemo(() => lucideFallback(type, isFolder), [type, isFolder]);

    return (
        <div style={{ width: size, height: size }} className={cn('relative flex items-center justify-center', className)}>
            {showFallback && (
                <FallbackIcon size={size} className="text-app-muted/60 shrink-0 absolute inset-0" />
            )}
            {src && cached?.status !== 'missing' && (
                <img
                    src={src}
                    alt=""
                    style={{ width: size, height: size }}
                    className="shrink-0 select-none"
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    onError={() => markThemedIconMissing(key)}
                />
            )}
        </div>
    );
});
