import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { NetworkInterfaceControl } from './NetworkInterfaceControl';
import { finishNetworkPrompt, useNetworkPromptStore, type NetworkPreference } from '../../features/connections/application/networkInterface';

/** Ask once per user-initiated connection; automatic transport recovery reuses the chosen adapter. */
export function GlobalNetworkInterfaceModal() {
    const prompt = useNetworkPromptStore(state => state.requests[0]);
    const [selection, setSelection] = useState<{ promptId: number; value: NetworkPreference } | null>(null);
    if (!prompt) return null;
    const choice: NetworkPreference = selection?.promptId === prompt.id ? selection.value : { mode: 'default' };
    return <Modal isOpen title="Choose network interface" onClose={() => finishNetworkPrompt(prompt.id, null)}>
        <div className="space-y-4 p-4">
            <p className="text-sm text-app-muted">Connect to {prompt.name}</p>
            <NetworkInterfaceControl key={prompt.id} value={choice}
                onChange={value => setSelection({ promptId: prompt.id, value })} allowAsk={false} />
            <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => finishNetworkPrompt(prompt.id, null)}>Cancel</Button>
                <Button onClick={() => finishNetworkPrompt(prompt.id, { interfaceId: choice.mode === 'interface' ? choice.id : undefined })}>Connect</Button>
            </div>
        </div>
    </Modal>;
}
