import { VaultTab } from '../settings/tabs/VaultTab';
import { VaultSyncHandoffStrip } from './VaultSyncHandoffStrip';
import { DEFAULT_VAULT_PROFILE_ID, type VaultProfileId } from '../../vault/profileTypes';

interface VaultWorkspacePanelProps {
    profileId?: VaultProfileId;
}

export default function VaultWorkspacePanel({
    profileId = DEFAULT_VAULT_PROFILE_ID,
}: VaultWorkspacePanelProps) {
    return (
        <div className="h-full overflow-auto">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-5">
                <VaultSyncHandoffStrip />
                <VaultTab focusedProfileId={profileId} />
            </div>
        </div>
    );
}