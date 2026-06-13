import { useVaultStore } from '../../vault/useVaultStore';
import { VaultUnlockModal } from './VaultUnlockModal';

export function GlobalVaultUnlockModal() {
    const unlockPromptOpen = useVaultStore((state) => state.unlockPromptOpen);
    const finishUnlockPrompt = useVaultStore((state) => state.finishUnlockPrompt);

    return (
        <VaultUnlockModal
            isOpen={unlockPromptOpen}
            onClose={finishUnlockPrompt}
        />
    );
}