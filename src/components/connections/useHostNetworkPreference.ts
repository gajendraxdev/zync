import { useEffect, useState } from 'react';
import { getNetworkPreference, type NetworkPreference } from '../../features/connections/application/networkInterface';

const DEFAULT_PREFERENCE: NetworkPreference = { mode: 'default' };

/** Load a device preference once per editor identity; stale completions cannot cross hosts. */
export function useHostNetworkPreference(isOpen: boolean, connectionId: string | null) {
    const [snapshot, setSnapshot] = useState<{ id: string | null; value: NetworkPreference; error: string } | null>(null);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let active = true;
        setSnapshot(null);
        if (!isOpen) return;
        const request = connectionId ? getNetworkPreference(connectionId) : Promise.resolve<NetworkPreference>({ mode: 'default' });
        void request.then(value => { if (active) setSnapshot({ id: connectionId, value, error: '' }); })
            .catch(error => { if (active) setSnapshot({ id: connectionId, value: { mode: 'default' }, error: String(error) }); });
        return () => { active = false; };
    }, [isOpen, connectionId, revision]);
    const current = snapshot?.id === connectionId ? snapshot : null;
    return { value: current?.value ?? DEFAULT_PREFERENCE,
        ready: Boolean(current && !current.error), error: current?.error || '',
        /** Keep the edited preference scoped to the currently open host draft. */
        setValue: (value: NetworkPreference) => setSnapshot({ id: connectionId, value, error: '' }),
        /** Retry only on explicit request; do not poll device storage. */
        retry: () => setRevision(value => value + 1) };
}
