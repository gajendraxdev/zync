import { memo, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  ensureThemedIcon,
  fileTypeIconID,
  getThemedIconEntry,
  reportThemedIconLoadError,
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
    const base = lower.split(/[/\\]/).pop() ?? lower;
    const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : base;
    if (lower.startsWith('.') || ['sh', 'bash', 'zsh', 'fish', 'ps1'].includes(ext)) return Terminal;
    if (
        lower.includes('config')
        || ['yml', 'yaml', 'toml', 'ini', 'json'].includes(ext)
        || ['exe', 'msi', 'apk', 'appimage', 'bin', 'iso', 'img', 'dll', 'so'].includes(ext)
    ) return Settings;
    if (lower.includes('key') || lower.includes('id_') || ['pem', 'pub', 'key', 'crt'].includes(ext)) return Lock;
    if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return Archive;
    if (['db', 'sqlite', 'sql'].includes(ext)) return Database;
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return Image;
    if (['js', 'ts', 'py', 'go', 'rs', 'c', 'cpp'].includes(ext)) return FileCode;
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
    const pluginPath = activePlugin?.path ?? '';
    const pluginIconsPath = activePlugin?.manifest?.iconsPath
        ?? (activePlugin?.manifest as { icons_path?: string } | undefined)?.icons_path
        ?? '';
    const key = themedIconKey(iconTheme, iconID, pluginId, pluginPath, pluginIconsPath);

    const [, setEpoch] = useState(0);
    const cached = iconTheme === 'lucide' ? { status: 'missing' as const } : getThemedIconEntry(key);

    useEffect(() => {
        if (iconTheme === 'lucide') return;
        const unsub = subscribeThemedIcon(key, () => setEpoch((n) => n + 1));
        setEpoch((n) => n + 1);
        ensureThemedIcon(key, iconID, iconTheme, pluginPath || undefined, pluginIconsPath || undefined);
        return unsub;
    }, [iconID, iconTheme, key, pluginIconsPath, pluginPath]);

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
                    onError={() => reportThemedIconLoadError(
                      key,
                      iconID,
                      iconTheme,
                      pluginPath || undefined,
                      pluginIconsPath || undefined,
                    )}
                />
            )}
        </div>
    );
});
