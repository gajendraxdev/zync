import { useState, useEffect } from 'react';
import { Search, Download, Trash2, Loader2, Package, Plug, Activity, Cpu, Gauge, Layers, Globe, Zap, Shield, Lock, Monitor, FileText, Settings as SettingsIcon, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';
import { usePlugins } from '../../context/PluginContext';
import { ipcRenderer } from '../../lib/tauri-ipc';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/useAppStore';

// Registry Data Type
interface RegistryPlugin {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    downloadUrl: string;
    thumbnailUrl?: string;
    icon?: string;
    mode?: 'dark' | 'light';
    type?: 'theme' | 'tool';
    sha256?: string; // Optional checksum for integrity verification
    permissions?: string[]; // The capabilities this plugin requires
}

interface MarketplaceProps {
    onPluginChange?: () => void;
}

// Registry URL (Make this configurable later)
const REGISTRY_URL = "https://raw.githubusercontent.com/zync-sh/zync-extensions/main/marketplace.json";

// Icon Resolver Helper
const IconResolver = ({ name, size = 16, className = "" }: { name?: string, size?: number, className?: string }) => {
    const icons: any = {
        Activity, Cpu, Gauge, Layers, Globe, Zap, Shield, Lock, Package, Plug, Monitor, FileText, SettingsIcon
    };

    const Icon = (name && icons[name]) || (name && icons[name.charAt(0).toUpperCase() + name.slice(1)]) || Plug;
    return <Icon size={size} className={className} />;
};

// Robust Image component with fallback to IconResolver
const PluginImage = ({ url, icon, name, size = 20 }: { url?: string, icon?: string, name: string, size?: number }) => {
    const [error, setError] = useState(false);

    if (url && !error) {
        return (
            <img
                src={url}
                alt={name}
                className="w-full h-full object-cover"
                onError={() => setError(true)}
            />
        );
    }

    return (
        <div className="w-full h-full flex items-center justify-center bg-[var(--color-app-bg)] text-[var(--color-app-accent)]">
            <IconResolver name={icon} size={size} />
        </div>
    );
};

export function Marketplace({ onPluginChange }: MarketplaceProps) {
    const { plugins: installedPlugins, loadPlugins } = usePlugins();
    const [registry, setRegistry] = useState<RegistryPlugin[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [pendingConsent, setPendingConsent] = useState<RegistryPlugin | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [error, setError] = useState<string | null>(null);
    const showConfirmDialog = useAppStore(state => state.showConfirmDialog);
    const showToast = useAppStore(state => state.showToast);

    useEffect(() => {
        fetchRegistry();
    }, []);

    const fetchRegistry = async () => {
        setIsLoading(true);
        setError(null);
        try {
            // Try fetching from real URL
            const res = await fetch(REGISTRY_URL);
            if (!res.ok) throw new Error('Failed to fetch registry');
            const data = await res.json();
            setRegistry(data.plugins || []);
        } catch (err) {
            console.error(err);
            // If fetch fails, we just show empty list since mock is empty now
            // But we might want to show the error to the user so they know to check their connection/URL
            setError("Failed to load marketplace registry.");
            setRegistry([]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleInstall = (plugin: RegistryPlugin) => {
        if (plugin.permissions && plugin.permissions.length > 0) {
            setPendingConsent(plugin);
        } else {
            executeInstall(plugin, []);
        }
    };

    const executeInstall = async (plugin: RegistryPlugin, approvedPermissions: string[]) => {
        setPendingConsent(null);
        setInstallingId(plugin.id);
        try {
            await ipcRenderer.invoke('plugins_install', {
                url: plugin.downloadUrl,
                sha256: plugin.sha256 ?? null,
                approvedPermissions: approvedPermissions
            });

            await loadPlugins(); // Trigger global refresh
            
            if (onPluginChange) {
                onPluginChange();
            } else {
                window.location.reload(); // Fallback
            }
        } catch (err: any) {
            console.error(err);
            alert(`Failed to install: ${err.message || err}`);
        } finally {
            setInstallingId(null);
        }
    };

    const handleUninstall = async (id: string) => {
        const confirmed = await showConfirmDialog({
            title: "Uninstall Plugin",
            message: "Are you sure you want to uninstall this plugin?",
            confirmText: "Uninstall",
            variant: "danger"
        });
        if (!confirmed) return;

        setInstallingId(id); // Use same loading state
        try {
            await ipcRenderer.invoke('plugins_uninstall', { id });
            await loadPlugins(); // Trigger global refresh
            showToast('success', 'Plugin uninstalled successfully');
            if (onPluginChange) {
                onPluginChange();
            } else {
                window.location.reload();
            }
        } catch (err: any) {
            console.error(err);
            showToast('error', `Failed to uninstall: ${err.message || err}`);
        } finally {
            setInstallingId(null);
        }
    };

    const isInstalled = (id: string) => {
        return installedPlugins.some(p => p.manifest.id === id);
    };

    const getInstalledVersion = (id: string) => {
        const p = installedPlugins.find(p => p.manifest.id === id);
        return p?.manifest.version;
    };

    const filteredPlugins = registry.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="flex flex-col h-full bg-[var(--color-app-bg)] text-[var(--color-app-text)]">
            {/* Header / Search */}
            <div className="p-4 border-b border-[var(--color-app-border)] flex items-center gap-3">
                <Search className="w-4 h-4 text-[var(--color-app-muted)]" />
                <input
                    type="text"
                    placeholder="Search plugins & themes..."
                    className="bg-transparent border-none outline-none flex-1 placeholder-[var(--color-app-muted)] text-sm"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full text-[var(--color-app-muted)] gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Loading registry...</span>
                    </div>
                ) : error ? (
                    <div className="text-red-500 text-center py-8">{error}</div>
                ) : (
                    filteredPlugins.map(plugin => {
                        const installed = isInstalled(plugin.id);
                        const localVersion = getInstalledVersion(plugin.id);
                        const processing = installingId === plugin.id;

                        return (
                            <div
                                key={plugin.id}
                                className={clsx(
                                    "p-2.5 rounded-lg flex gap-3 border transition-colors",
                                    "border-[var(--color-app-border)] hover:bg-[var(--color-app-surface)]"
                                )}
                            >
                                {/* Thumbnail / Icon */}
                                <div className="w-10 h-10 rounded bg-[var(--color-app-surface)] flex items-center justify-center shrink-0 border border-[var(--color-app-border)] overflow-hidden">
                                    <PluginImage url={plugin.thumbnailUrl} icon={plugin.icon} name={plugin.name} />
                                </div>

                                {/* Details */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="font-medium text-sm text-[var(--color-app-text)] leading-tight">{plugin.name}</h3>
                                            <p className="text-[10px] text-[var(--color-app-muted)] mt-0.5">v{plugin.version} • by {plugin.author}</p>
                                        </div>
                                        {/* Action Button */}
                                        {installed ? (
                                            <div className="flex items-center gap-2">
                                                {localVersion && plugin.version !== localVersion && (
                                                    <button
                                                        onClick={() => handleInstall(plugin)}
                                                        disabled={processing}
                                                        className={clsx(
                                                            "px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1.5 transition-colors",
                                                            "bg-blue-500 text-white hover:opacity-90",
                                                            processing && "opacity-50 cursor-not-allowed"
                                                        )}
                                                    >
                                                        {processing && installingId === plugin.id ? (
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                        ) : (
                                                            <Download className="w-3 h-3" />
                                                        )}
                                                        Update
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleUninstall(plugin.id)}
                                                    disabled={processing}
                                                    className={clsx(
                                                        "px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1.5 transition-colors",
                                                        "bg-[var(--color-app-surface)] hover:bg-red-500/10 hover:text-red-500 text-[var(--color-app-muted)]",
                                                        processing && "opacity-50 cursor-not-allowed"
                                                    )}
                                                >
                                                    {processing && !installingId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                                    Uninstall
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => handleInstall(plugin)}
                                                disabled={processing}
                                                className={clsx(
                                                    "px-2.5 py-1.5 rounded text-[10px] font-medium flex items-center gap-1.5 transition-colors",
                                                    "bg-[var(--color-app-accent)] text-white hover:opacity-90",
                                                    processing && "opacity-50 cursor-not-allowed"
                                                )}
                                            >
                                                {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                                Install
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-[var(--color-app-muted)] mt-1 line-clamp-1 opacity-80">
                                        {plugin.description}
                                    </p>
                                </div>
                            </div>
                        );
                    })
                )}

                {!isLoading && filteredPlugins.length === 0 && (
                    <div className="text-center py-12 text-[var(--color-app-muted)]">
                        <p>No results found for "{searchQuery}"</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-[var(--color-app-border)] text-[10px] text-[var(--color-app-muted)] flex justify-between">
                <span>Registry: GitHub (Static)</span>
            </div>

            {/* Dynamic Consent Modal */}
            <Modal
                isOpen={pendingConsent !== null}
                onClose={() => setPendingConsent(null)}
                title="Plugin Installation"
                width="max-w-md"
            >
                {pendingConsent && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
                            <ShieldAlert className="shrink-0" size={20} />
                            <p className="text-sm font-medium">
                                This plugin wants access to the following secure APIs.
                            </p>
                        </div>
                        
                        <div className="text-sm text-[var(--color-app-text)] leading-relaxed bg-[var(--color-app-surface)] p-3 rounded-lg border border-[var(--color-app-border)]">
                            <ul className="space-y-2">
                                {pendingConsent.permissions?.map(p => (
                                    <li key={p} className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-app-accent)]" />
                                        <code className="text-xs bg-black/20 px-1.5 py-0.5 rounded text-[var(--color-app-muted)]">
                                            {p}
                                        </code>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <p className="text-[11px] text-[var(--color-app-muted)]">
                            You should only grant permissions to authors you trust. If you are unsure, do not install this plugin.
                        </p>

                        <div className="flex justify-end gap-3 pt-2">
                            <Button
                                variant="ghost"
                                onClick={() => setPendingConsent(null)}
                                className="hover:bg-[var(--color-app-surface)]"
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={() => executeInstall(pendingConsent, pendingConsent.permissions || [])}
                                className="min-w-[100px] bg-[var(--color-app-accent)] text-white border-none transition-colors"
                            >
                                Allow and Install
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
