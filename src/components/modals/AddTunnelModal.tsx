import { useState, useEffect } from 'react';
import { ArrowRight, Laptop, Server as ServerIcon, Zap, Plus, Trash2, Layers } from 'lucide-react';
import { useAppStore, type Connection, type TunnelConfig } from '../../store/useAppStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { GroupSelector } from '../ui/GroupSelector';
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
    const tunnels = useAppStore(state => state.tunnels);
    const showToast = useAppStore((state) => state.showToast);

    // Derive existing groups for autocomplete
    const existingGroups = Array.from(new Set(
        Object.values(tunnels)
            .flat()
            .map(t => t.group)
            .filter((g): g is string => !!g)
    )).sort();

    // Form State
    const [mode, setMode] = useState<'single' | 'bulk'>('single');
    const [selectedConnectionId, setSelectedConnectionId] = useState('');
    const [name, setName] = useState('');
    const [group, setGroup] = useState('');
    const [type, setType] = useState<'local' | 'remote'>('local');
    const [localPort, setLocalPort] = useState('8080');
    const [remoteHost, setRemoteHost] = useState('127.0.0.1');
    const [remotePort, setRemotePort] = useState('80');
    const [bindAddress, setBindAddress] = useState('127.0.0.1');
    const [autoStart, setAutoStart] = useState(false);

    // Bulk State
    const [bulkRows, setBulkRows] = useState<Array<{ type: 'local' | 'remote', localPort: string, remoteHost: string, remotePort: string }>>([
        { type: 'local', localPort: '8080', remoteHost: '127.0.0.1', remotePort: '80' }
    ]);

    const saveTunnel = useAppStore(state => state.saveTunnel);

    // Reset/Pre-fill form on open
    useEffect(() => {
        if (isOpen) {
            if (editingTunnel) {
                setSelectedConnectionId(editingTunnel.connectionId);
                setName(editingTunnel.name);
                setGroup(editingTunnel.group || '');
                setType(editingTunnel.type);
                setLocalPort(editingTunnel.localPort.toString());
                setRemoteHost(editingTunnel.remoteHost);
                setRemotePort(editingTunnel.remotePort.toString());
                setBindAddress(editingTunnel.bindAddress || '127.0.0.1');
                setAutoStart(editingTunnel.autoStart || false);
                setMode('single'); // Force single mode when editing
            } else {
                // If we have an initial connection ID, ALWAYS use it and ensure it's set
                if (initialConnectionId) {
                    setSelectedConnectionId(initialConnectionId);
                } else {
                    setSelectedConnectionId('');
                }

                setName('');
                setGroup('');
                setType('local');
                setLocalPort('8080');
                setRemoteHost('127.0.0.1');
                setRemotePort('80');
                setBindAddress('127.0.0.1');
                setAutoStart(false);
                setMode('single');
                setBulkRows([{ type: 'local', localPort: '8080', remoteHost: '127.0.0.1', remotePort: '80' }]);
            }
        }
    }, [isOpen, initialConnectionId, editingTunnel]);

    const handleSave = async () => {
        if (!selectedConnectionId) {
            showToast('error', 'Please select a host');
            return;
        }

        if (mode === 'single') {
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
                    status: editingTunnel?.status || 'stopped',
                    group: group.trim() || undefined
                };

                await saveTunnel(config);
                showToast('success', editingTunnel ? 'Forward updated successfully' : 'Forward created successfully');
                onClose();
            } catch (error: any) {
                showToast('error', `Failed to save forward: ${error.message}`);
            }
        } else {
            // Bulk Save
            let successCount = 0;
            // Validate all first
            for (const row of bulkRows) {
                const lPort = parseInt(row.localPort);
                const rPort = parseInt(row.remotePort);
                if (isNaN(lPort) || isNaN(rPort)) {
                    showToast('error', 'All ports must be valid numbers');
                    return;
                }
            }

            // Save sequentially
            for (const row of bulkRows) {
                const lPort = parseInt(row.localPort);
                const rPort = parseInt(row.remotePort);
                try {
                    const config: TunnelConfig = {
                        id: crypto.randomUUID(),
                        connectionId: selectedConnectionId,
                        name: (row.type === 'local' ? `Local ${lPort} -> ${row.remoteHost}:${rPort}` : `Remote ${rPort} -> Local ${lPort}`),
                        type: row.type,
                        localPort: lPort,
                        remoteHost: row.remoteHost,
                        remotePort: rPort,
                        bindAddress: '127.0.0.1', // Default for bulk
                        autoStart: false,
                        status: 'stopped',
                        group: group.trim() || undefined
                    };
                    await saveTunnel(config);
                    successCount++;
                } catch (error: any) {
                    console.error('Failed to save bulk tunnel', error);
                }
            }

            if (successCount > 0) {
                showToast('success', `Created ${successCount} forwards`);
                onClose();
            } else {
                showToast('error', 'Failed to create forwards');
            }
        }
    };

    // Filter only valid SSH connections
    // Filter only valid SSH connections, but ALWAYS include the initial/selected one
    const hostOptions = connections
        .filter((c: Connection) => c.host || c.id === initialConnectionId || c.id === selectedConnectionId)
        .map((conn: Connection) => ({
            value: conn.id,
            label: conn.name || conn.host || 'Unknown Host',
            description: conn.host ? `${conn.username}@${conn.host}` : 'Local/Custom Connection',
            icon: (
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-app-surface border border-app-border">
                    <OSIcon icon={conn.icon || 'Server'} className="w-3.5 h-3.5" />
                </div>
            )
        }));

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={editingTunnel ? "Update Port Forward" : "Create Port Forward"}>
            <div className="p-4 space-y-4">
                {/* Server and Group Selection Row */}
                <div className="grid grid-cols-2 gap-4">
                    <Select
                        label="Assign to Server"
                        placeholder="Select server..."
                        value={selectedConnectionId}
                        onChange={setSelectedConnectionId}
                        options={hostOptions}
                        disabled={!!initialConnectionId}
                    />

                    <GroupSelector
                        label="Assign Group"
                        value={group}
                        onChange={setGroup}
                        existingGroups={existingGroups}
                        placeholder="Optional group name..."
                    />
                </div>

                {!editingTunnel && (
                    <div className="flex bg-app-surface/50 p-1 rounded-lg border border-app-border/40">
                        <button
                            onClick={() => setMode('single')}
                            className={cn(
                                "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all",
                                mode === 'single'
                                    ? "bg-app-accent text-white shadow-sm"
                                    : "text-app-muted hover:text-app-text hover:bg-app-highlight/30"
                            )}
                        >
                            <Zap size={14} /> Single Forward
                        </button>
                        <button
                            onClick={() => setMode('bulk')}
                            className={cn(
                                "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-all",
                                mode === 'bulk'
                                    ? "bg-app-accent text-white shadow-sm"
                                    : "text-app-muted hover:text-app-text hover:bg-app-highlight/30"
                            )}
                        >
                            <Layers size={14} /> Bulk Entry
                        </button>
                    </div>
                )}

                {mode === 'single' ? (
                    <>
                        <div className="space-y-4 pt-2 border-t border-app-border/30">
                            <div className="space-y-1">
                                <label className="text-[10px] font-medium text-app-muted uppercase tracking-wider pl-0.5">Name (Optional)</label>
                                <Input
                                    placeholder={type === 'local' ? "e.g. Postgres DB" : "e.g. Webhooks"}
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="bg-app-surface border-app-border/40 focus:border-app-accent/40 h-9"
                                />
                            </div>

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

                            {/* Connection Details */}
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
                        </div>
                    </>
                ) : (
                    // Bulk Mode UI
                    <div className="space-y-3 pt-2 border-t border-app-border/30">
                        <div className="bg-app-surface/30 rounded-xl border border-app-border/50">
                            <div className="grid grid-cols-12 gap-3 px-4 py-2 bg-app-surface/50 border-b border-app-border/30 text-[10px] font-bold text-app-muted uppercase tracking-wider rounded-t-xl">
                                <div className="col-span-3">Type</div>
                                <div className="col-span-2">Local Port</div>
                                <div className="col-span-3">Remote Host</div>
                                <div className="col-span-3">Remote Port</div>
                                <div className="col-span-1"></div>
                            </div>

                            <div className="p-2 space-y-1">
                                {bulkRows.map((row, index) => (
                                    <div key={index} className="grid grid-cols-12 gap-3 items-center p-1 hover:bg-app-surface/40 rounded-lg transition-colors group">
                                        <div className="col-span-3">
                                            <Select
                                                value={row.type}
                                                onChange={(value) => {
                                                    const newRows = [...bulkRows];
                                                    newRows[index].type = value as 'local' | 'remote';
                                                    setBulkRows(newRows);
                                                }}
                                                options={[
                                                    { value: 'local', label: 'Local' },
                                                    { value: 'remote', label: 'Remote' }
                                                ]}
                                                showSearch={false}
                                                triggerClassName="h-9 px-2 text-xs"
                                                showCheck={false}
                                                itemClassName="text-xs px-2"
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <Input
                                                value={row.localPort}
                                                onChange={(e) => {
                                                    const newRows = [...bulkRows];
                                                    newRows[index].localPort = e.target.value;
                                                    setBulkRows(newRows);
                                                }}
                                                placeholder="8080"
                                                className="h-9 text-xs font-mono"
                                            />
                                        </div>
                                        <div className="col-span-3">
                                            <Input
                                                value={row.remoteHost}
                                                onChange={(e) => {
                                                    const newRows = [...bulkRows];
                                                    newRows[index].remoteHost = e.target.value;
                                                    setBulkRows(newRows);
                                                }}
                                                placeholder="localhost"
                                                className="h-9 text-xs"
                                            />
                                        </div>
                                        <div className="col-span-3">
                                            <Input
                                                value={row.remotePort}
                                                onChange={(e) => {
                                                    const newRows = [...bulkRows];
                                                    newRows[index].remotePort = e.target.value;
                                                    setBulkRows(newRows);
                                                }}
                                                placeholder="80"
                                                className="h-9 text-xs font-mono"
                                            />
                                        </div>
                                        <div className="col-span-1 flex justify-end">
                                            <button
                                                onClick={() => {
                                                    if (bulkRows.length > 1) {
                                                        const newRows = bulkRows.filter((_, i) => i !== index);
                                                        setBulkRows(newRows);
                                                    }
                                                }}
                                                disabled={bulkRows.length <= 1}
                                                className="p-2 text-app-muted hover:text-red-400 hover:bg-red-400/10 rounded-lg disabled:opacity-0 transition-all"
                                                title="Remove Row"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Button
                            variant="ghost"
                            onClick={() => setBulkRows([...bulkRows, { type: 'local', localPort: '', remoteHost: 'localhost', remotePort: '' }])}
                            className="w-full py-2 text-xs border border-dashed border-app-border/50 text-app-muted hover:text-app-text hover:border-app-accent/50 hover:bg-app-accent/5"
                        >
                            <Plus size={14} className="mr-1.5" /> Add Another Row
                        </Button>
                    </div>
                )}

                {/* Footer */}
                <div className="flex justify-end gap-3 pt-4 mt-2 border-t border-app-border/30">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button
                        onClick={handleSave}
                        className="bg-app-accent text-white hover:bg-app-accent/90"
                    >
                        {editingTunnel ? 'Update Forward' : mode === 'bulk' ? `Create ${bulkRows.length} Forwards` : 'Create Forward'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
