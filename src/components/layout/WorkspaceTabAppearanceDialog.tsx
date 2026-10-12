import type { Tab } from '../../features/connections/domain/types';
import type { MainTabPresentationAction } from '../../features/workspace/domain/mainTabPresentation';
import { WorkspaceTabAppearanceControls } from './WorkspaceTabAppearanceControls';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

/** Appearance-only editor; rename drafts, ordering and resource actions stay separate. */
export function WorkspaceTabAppearanceDialog({ tab, onChange, onClose }: {
    tab: Tab;
    onChange: (action: MainTabPresentationAction) => boolean;
    onClose: () => void;
}) {
    return <Modal isOpen title="Tab appearance" width="max-w-md" showCloseButton={false} onClose={onClose}>
        <WorkspaceTabAppearanceControls value={tab.presentation} onChange={onChange} />
        <div className="mt-4 flex justify-end"><Button type="button" variant="secondary" onClick={onClose}>Done</Button></div>
    </Modal>;
}
