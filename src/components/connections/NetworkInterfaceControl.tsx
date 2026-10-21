import { useEffect, useMemo, useState } from 'react';
import { Network, Wifi, Cable, RotateCcw, Globe, CircleHelp } from 'lucide-react';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { listNetworkInterfaces, type NetworkInterface, type NetworkPreference } from '../../features/connections/application/networkInterface';
import { orderedInterfaceAddresses } from '../../features/connections/domain/formPresentation';

interface Props { value: NetworkPreference; onChange: (value: NetworkPreference) => void; allowAsk?: boolean; disabled?: boolean }

/** Shared adapter picker for Advanced and connect-time selection; no polling or global adapter cache. */
export function NetworkInterfaceControl({ value, onChange, allowAsk = true, disabled = false }: Props) {
    const [revision, setRevision] = useState(0);
    const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        void listNetworkInterfaces().then(items => { if (active) setInterfaces(items); })
            .catch(failure => { if (active) setError(String(failure)); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [revision]);
    const selectedId = value.mode === 'interface' ? value.id : null;
    const available = useMemo(() => interfaces.filter(item => item.available), [interfaces]);
    const selected = available.find(item => item.id === selectedId);
    return <div className="space-y-2">
        <div className="flex items-end gap-2">
            <Select label="Network interface" portal disabled={disabled || loading}
                value={selectedId ? `interface:${selectedId}` : value.mode}
                onChange={choice => onChange(choice.startsWith('interface:') ? { mode: 'interface', id: choice.slice(10) }
                    : { mode: choice === 'ask' ? 'ask' : 'default' })}
                options={[
                    { value: 'default', label: 'System default', icon: <Globe aria-hidden className="h-4 w-4" /> },
                    ...(allowAsk ? [{ value: 'ask', label: 'Ask every time', icon: <CircleHelp aria-hidden className="h-4 w-4" /> }] : []),
                    ...available.map(item => {
                        const Icon = item.kind === 'wifi' ? Wifi : item.kind === 'ethernet' ? Cable
                            : item.kind === 'loopback' ? RotateCcw : Network;
                        return { value: `interface:${item.id}`, label: item.name,
                            description: [item.description, orderedInterfaceAddresses(item.addresses).join(', ')].filter(Boolean).join(' · ') || 'No IP address reported',
                            icon: <Icon aria-hidden className="h-4 w-4" /> };
                    }),
                    ...(selectedId && !available.some(item => item.id === selectedId)
                        ? [{ value: `interface:${selectedId}`, label: 'Selected adapter unavailable' }] : []),
                ]} />
            <Button variant="secondary" size="sm" disabled={loading || disabled} onClick={() => setRevision(current => current + 1)}>Refresh</Button>
        </div>
        {selected?.description && <p className="text-xs text-app-muted break-words select-text">{selected.description}</p>}
        {selected && <p className="text-xs text-app-muted break-all select-text">
            {orderedInterfaceAddresses(selected.addresses).join(', ') || 'No IP address reported'}
        </p>}
        {loading && <p role="status" className="text-xs text-app-muted">Loading adapters…</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>;
}
