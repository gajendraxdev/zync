import { Settings } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { resolveWorkspaceNavigation } from '../../features/workspace/domain/navigation';
import { IconButton } from '../ui/IconButton';
import { ProfileSyncMenu } from './ProfileSyncMenu';
import { Tooltip } from '../ui/Tooltip';
import { shortcutHint } from '../../features/shortcuts/labels';

/** Exactly one visible utility group: activity-bar footer, or title-bar fallback. */
export function GlobalUtilityActions({ location }: { location: 'topbar' | 'activity' }) {
    const raw = useAppStore(state => state.settings.workspaceNavigation);
    const openSettings = useAppStore(state => state.openSettings);
    const keybindings = useAppStore(state => state.settings.keybindings);
    const visible = resolveWorkspaceNavigation(raw).visible;
    if ((location === 'activity') !== visible) return null;
    return <div aria-label="Global utilities" className={location === 'activity' ? 'flex flex-col items-center gap-1 shrink-0' : 'flex items-center gap-1'}>
        <Tooltip content={`Settings (${shortcutHint('toggleSettings', keybindings)})`} position={location === 'topbar' ? 'bottom' : resolveWorkspaceNavigation(raw).position === 'right' ? 'left' : 'right'}>
            <IconButton label="Settings" icon={<Settings size={18} aria-hidden="true" />} onClick={() => openSettings()} />
        </Tooltip>
        <ProfileSyncMenu compact={location === 'activity'} />
    </div>;
}
