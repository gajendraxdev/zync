import { registerModal, type BaseModalProps } from '../../lib/modalRegistry';
import { useAppStore } from '../../store/useAppStore';
import { Modal } from '../ui/Modal';
import { ShortcutsTab } from './tabs/ShortcutsTab';

/** Quick access to the Settings editor, with identical validation and persistence. */
export function KeyboardShortcutsModal({ isOpen, onClose }: BaseModalProps) {
    const settings = useAppStore(state => state.settings);
    const updateKeybindings = useAppStore(state => state.updateKeybindings);
    return <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts" width="max-w-3xl"
        subtitle="Find actions, record primary or secondary bindings, and choose which keys Zync owns in a terminal.">
        <ShortcutsTab settings={settings} updateKeybindings={updateKeybindings} />
    </Modal>;
}

registerModal('keyboardShortcuts', KeyboardShortcutsModal);
