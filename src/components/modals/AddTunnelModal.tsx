import { useState, useEffect } from 'react';
import { ArrowRight, Laptop, Server as ServerIcon, Zap } from 'lucide-react';
import { useAppStore, type Connection, type TunnelConfig } from '../../store/useAppStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { OSIcon } from '../icons/OSIcon';
import { cn } from '../../lib/utils';

interface AddTunnelModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialConnectionId?: string; // Pre-select if opened from context
    editingTunnel?: TunnelConfig | null; // Pass existing tunnel to edit
}

export function AddTunnelModal({ isOpen, onClose, initialConnectionId, editingTunnel }: AddTunnelModalProps) {
    const connections = useAppStore(state => state.connections);
    const showToast = useAppStore((state) => state.showToast);

    // Form State
    const [selectedConnectionId, setSelectedConnectionId] = useState('');
    const [name, setName] = useState('');
    const [type, setType] = useState<'local' | 'remote'>('local');
    const [localPort, setLocalPort] = useState('8080');
    const [remoteHost, setRemoteHost] = useState('127.0.0.1');
    const [remotePort, setRemotePort] = useState('80');
    const [bindAddress, setBindAddress] = useState('127.0.0.1');
    const [autoStart, setAutoStart] = useState(false);

    const saveTunnel = useAppStore(state => state.saveTunnel);

    // Reset/Pre-fill form on open
    useEffect(() => {
        if (isOpen) {
            if (editingTunnel) {
                setSelectedConnectionId(editingTunnel.connectionId);
                setName(editingTunnel.name);
                setType(editingTunnel.type);
                setLocalPort(editingTunnel.localPort.toString());
                setRemoteHost(editingTunnel.remoteHost);
                setRemotePort(editingTunnel.remotePort.toString());
                setBindAddress(editingTunnel.bindAddress || '127.0.0.1');
                setAutoStart(editingTunnel.autoStart || false);
            } else {
                setSelectedConnectionId(initialConnectionId || '');
                setName('');
                setType('local');
                setLocalPort('8080');
                setRemoteHost('127.0.0.1');
                setRemotePort('80');
                setBindAddress('127.0.0.1');
                setAutoStart(false);
            }
        }
    }, [isOpen, initialConnectionId, editingTunnel]);

    const handleSave = async () => {
        if (!selectedConnectionId) {
            showToast('error', 'Please select a host');
            return;
        }

        const lPort = parseInt(localPort);
        const rPort = parseInt(remotePort);

        if (isNaN(lPort) || rPort < 1) {
            showToast('error', 'Ports must be valid numbers');
            return;
        }

        try {
            const config: TunnelConfig = {
                id: editingTunnel?.id || crypto.randomUUID(),
                connectionId: selectedConnectionId,
                name: name || (type === 'local' ? `Local ${lPort} -> ${remoteHost}:${rPort}` : `Remote ${rPort} -> Local ${lPort}`),
                type,
                localPort: lPort,
                remoteHost,
                remotePort: rPort,
                bindAddress,
                autoStart,
                status: editingTunnel?.status || 'stopped'
            };

            await saveTunnel(config);
            showToast('success', editingTunnel ? 'Forward updated successfully' : 'Forward created successfully');
            onClose();
        } catch (error: any) {
            showToast('error', `Failed to save forward: ${error.message}`);
        }
    };

    // Filter only valid SSH connections
    const hostOptions = connections
        .filter((c: Connection) => c.host)
        .map((conn: Connection) => ({
            value: conn.id,
            label: conn.name || conn.host,
            description: `${conn.username}@${conn.host}`,
            icon: (
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-app-surface border border-app-border">
                    <OSIcon icon={conn.icon || 'Server'} className="w-3.5 h-3.5" />
                </div>
            )
        }));

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Port Forward">
            <div className="p-4 space-y-4">
                {/* Host Selection */}
                <Select
                    label="Target Server"
                    placeholder="Select a server..."
                    value={selectedConnectionId}
                    onChange={setSelectedConnectionId}
                    options={hostOptions}
                />

                {/* Premium Form Content */}
                <div className="space-y-4 pt-2 border-t border-app-border/30">
                    {/* Tunnel Type UI */}
                    <div className="flex-shrink-0 p-1 bg-app-surface/50 rounded-lg border border-app-border">
                        <div className="flex gap-1">
                            <button
                                onClick={() => {
                                    setType('local');
                                    setRemoteHost('127.0.0.1');
                                    setBindAddress('127.0.0.1');
                                }}
                                className={cn(
                                    "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-2",
                                    type === 'local' ? "bg-app-accent text-white shadow-sm" : "text-app-muted hover:text-app-text hover:bg-white/5"
                                )}
                            >
                                <Laptop size={14} />
                                Local Forwarding
                            </button>
                            <button
                                onClick={() => {
                                    setType('remote');
                                    setBindAddress('0.0.0.0');
                                }}
                                className={cn(
                                    "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-2",
                                    type === 'remote' ? "bg-app-accent text-white shadow-sm" : "text-app-muted hover:text-app-text hover:bg-white/5"
                                )}
                            >
                                <ServerIcon size={14} />
                                Remote Forwarding
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-app-muted uppercase tracking-wider">Display Name (Optional)</label>
                        <Input
                            placeholder={type === 'local' ? "e.g. Web App" : "e.g. Remote Debug"}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-12 gap-3 items-end bg-app-surface/30 p-3 rounded-xl border border-app-border/50">
                        {type === 'local' ? (
                            <>
                                <div className="col-span-3">
                                    <Input
                                        label="Source Port"
                                        placeholder="8080"
                                        value={localPort}
                                        onChange={(e) => setLocalPort(e.target.value)}
                                    />
                                </div>
                                <div className="col-span-1 flex justify-center items-center h-10 text-app-muted/50 pb-1">
                                    <ArrowRight size={16} />
                                </div>
                                <div className="col-span-5">
                                    <Input
                                        label="Dest Host"
                                        placeholder="127.0.0.1"
                                        value={remoteHost}
                                        onChange={(e) => setRemoteHost(e.target.value)}
                                    />
                                </div>
                                <div className="col-span-3">
                                    <Input
                                        label="Dest Port"
                                        placeholder="80"
                                        value={remotePort}
                                        onChange={(e) => setRemotePort(e.target.value)}
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="col-span-3">
                                    <Input
                                        label="Remote Port"
                                        placeholder="9090"
                                        value={remotePort}
                                        onChange={(e) => setRemotePort(e.target.value)}
                                    />
                                </div>
                                <div className="col-span-1 flex justify-center items-center h-10 text-app-muted/50 pb-1">
                                    <ArrowRight size={16} />
                                </div>
                                <div className="col-span-5">
                                    <Input
                                        label="Local Host"
                                        placeholder="127.0.0.1"
                                        value={remoteHost}
                                        onChange={(e) => setRemoteHost(e.target.value)}
                                    />
                                </div>
                                <div className="col-span-3">
                                    <Input
                                        label="Local Port"
                                        placeholder="3000"
                                        value={localPort}
                                        onChange={(e) => setLocalPort(e.target.value)}
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    {/* Bind Address Input */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-app-muted uppercase tracking-wider">
                            Listening On ({type === 'local' ? 'Local machine' : 'Remote server'})
                        </label>
                        <Input
                            placeholder={type === 'local' ? "127.0.0.1" : "0.0.0.0"}
                            value={bindAddress}
                            onChange={(e) => setBindAddress(e.target.value)}
                        />
                    </div>
                </div>

                {/* Visual Flow Helper */}
                <div className="text-[11px] text-app-muted flex items-center gap-2 px-1 py-1 overflow-hidden opacity-80">
                    {type === 'local' ? (
                        <>
                            <Laptop size={12} className="text-app-accent shrink-0" />
                            <span className="font-medium text-app-text whitespace-nowrap">Local</span>
                            <span className="opacity-60">:{localPort || '...'}</span>
                            <ArrowRight size={10} className="shrink-0" />
                            <ServerIcon size={12} className="shrink-0" />
                            <span className="font-medium text-app-text truncate">{remoteHost || '...'}</span>
                            <span className="opacity-60 shrink-0">:{remotePort || '...'}</span>
                        </>
                    ) : (
                        <>
                            <ServerIcon size={12} className="text-app-accent shrink-0" />
                            <span className="font-medium text-app-text whitespace-nowrap">Server</span>
                            <span className="opacity-60">:{remotePort || '...'}</span>
                            <ArrowRight size={10} className="shrink-0" />
                            <Laptop size={12} className="shrink-0" />
                            <span className="font-medium text-app-text whitespace-nowrap">Local</span>
                            <span className="opacity-60 shrink-0">:{localPort || '...'}</span>
                        </>
                    )}
                </div>

                {/* Options Row */}
                <div className="flex gap-4 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer group flex-1">
                        <input
                            type="checkbox"
                            checked={autoStart}
                            onChange={e => setAutoStart(e.target.checked)}
                            className="rounded border-app-border bg-app-surface text-app-accent focus:ring-offset-app-bg focus:ring-app-accent"
                        />
                        <div className="flex items-center gap-1.5">
                            <Zap size={12} className={cn("transition-colors", autoStart ? "text-yellow-400 fill-yellow-400" : "text-app-muted")} />
                            <span className="text-sm text-app-text group-hover:text-app-accent transition-colors">Start automatically</span>
                        </div>
                    </label>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 pt-4 mt-2 border-t border-app-border/30">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button
                        onClick={handleSave}
                        className="bg-app-accent text-white hover:bg-app-accent/90"
                    >
                        Create Forward
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
