import { Section } from '../../common/Section';
import { SettingsGroup } from '../../common/SettingsGroup';
import { Select } from '../../../ui/Select';
import { MAIN_TAB_CLOSE_BUTTON_OPTIONS, resolveMainTabCloseButton, type MainTabCloseButtonMode } from '../../../../features/workspace/domain/mainTabPresentation';

export function WorkspaceTabsSection({ closeButtonMode, onCloseButtonModeChange }: {
    closeButtonMode: unknown;
    onCloseButtonModeChange: (mode: MainTabCloseButtonMode) => void;
}) {
    return <Section title="Main workspace tabs">
        <SettingsGroup>
            <Select label="Workspace tab close button" value={resolveMainTabCloseButton(closeButtonMode)}
                options={[...MAIN_TAB_CLOSE_BUTTON_OPTIONS]}
                onChange={value => onCloseButtonModeChange(resolveMainTabCloseButton(value))} />
            <p className="text-xs text-app-muted">Applies to tabs without an appearance override. Right-click → Close tab is always available.</p>
        </SettingsGroup>
    </Section>;
}
