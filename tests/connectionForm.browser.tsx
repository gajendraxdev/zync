import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { AddConnectionModal } from '../src/components/modals/AddConnectionModal';
import { GlobalNetworkInterfaceModal } from '../src/components/connections/GlobalNetworkInterfaceModal';
import { useAppStore } from '../src/store/useAppStore';
import { useVaultStore } from '../src/vault/useVaultStore';
import { Button } from '../src/components/ui/Button';
import type { Connection } from '../src/features/connections/domain/types';
import '../src/index.css';
import './uiOverlays.browser.css';

const keyHost: Connection = { id: 'fixture-key', name: 'Lab', host: 'fixture.invalid', port: 22222,
    username: 'fixture', privateKeyPath: 'C:\\fixture\\client', status: 'disconnected' };
const pendingTests: { resolve: (result: string) => void; reject: (error: Error) => void }[] = [];
let certificateDialogAttempt = 0;

// Mock the dialog plugin itself so production Browse handling is exercised without native UI.
Object.assign(window, { __TAURI_INTERNALS__: {
    async invoke(command: string) {
        if (command !== 'plugin:dialog|open') throw new Error(`Unexpected Tauri fixture call: ${command}`);
        certificateDialogAttempt++;
        if (certificateDialogAttempt === 1) throw new Error('fixture dialog failure');
        if (certificateDialogAttempt === 2) throw 'fixture string failure';
        if (certificateDialogAttempt === 3) return 'C:\\fixture\\picked-cert.pub';
        return null;
    },
} });

// Test-only native boundary: no credentials, sockets, adapters or files are accessed.
window.ipcRenderer = {
    async invoke(channel: string) {
        if (channel === 'ssh:test') return new Promise<string>((resolve, reject) => { pendingTests.push({ resolve, reject }); });
        if (channel === 'ssh:networkPreference') return { mode: 'default' };
        if (channel === 'ssh:networkInterfaces') return [
            { id: 'wifi', name: 'Wi-Fi fixture', description: 'Fixture wireless driver', kind: 'wifi', addresses: ['fe80::12', '192.0.2.5'], available: true },
            { id: 'loopback', name: 'Loopback fixture', kind: 'loopback', addresses: ['::1', '127.0.0.1'], available: true },
        ];
        if (channel === 'ssh:private-key-readiness' || channel === 'ssh:inspect-private-key') return { status: 'valid', encrypted: false };
        throw new Error(`Unexpected native call in host form fixture: ${channel}`);
    },
} as typeof window.ipcRenderer;

useAppStore.setState({ connections: [keyHost], folders: [{ name: 'Development' }],
    addConnection: async connection => { useAppStore.setState(state => ({ connections: [...state.connections, connection] })); },
    editConnection: async connection => { useAppStore.setState(state => ({ connections: state.connections.map(item => item.id === connection.id ? connection : item) })); },
    openTab: () => {},
    showToast: (type, message) => { document.body.dataset.fixtureToast = `${type}:${message}`; },
});
useVaultStore.setState({ status: { status: 'unlocked', vaultId: 'fixture-vault', itemCount: 0 }, items: [], refreshItems: async () => {} });

/** Production modal with deterministic native ports; the controls expose delayed-result regressions. */
function Fixture() {
    const [open, setOpen] = useState(true);
    const [editing, setEditing] = useState<string | null>(null);
    return <TooltipProvider><main className="p-5 text-app-text">
        <div className="flex flex-wrap gap-3">
            <Button onClick={() => { setEditing(null); setOpen(true); }}>New host fixture</Button>
            <Button onClick={() => { setEditing(keyHost.id); setOpen(true); }}>Key host fixture</Button>
            <Button onClick={() => pendingTests.shift()?.resolve('ok')}>Finish test</Button>
            <Button onClick={() => pendingTests.shift()?.reject(new Error('Connection refused (os error 10061)'))}>Reject test</Button>
            <Button onClick={() => useAppStore.setState(state => ({ connections: state.connections.map(connection => ({
                ...connection, status: 'connected', lastConnected: Date.now(), homePath: '/fixture/home',
            })) }))}>Update connection status</Button>
            <Button onClick={() => { document.body.dataset.overlayGalleryTheme = document.body.dataset.overlayGalleryTheme === 'light' ? 'dark' : 'light'; }}>Toggle theme</Button>
        </div>
        <AddConnectionModal isOpen={open} editingConnectionId={editing} onClose={() => setOpen(false)} />
        <GlobalNetworkInterfaceModal />
    </main></TooltipProvider>;
}

document.body.dataset.overlayGalleryTheme = 'dark';
createRoot(document.getElementById('root')!).render(<Fixture />);
