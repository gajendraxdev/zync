import { createAcknowledgedPreferencesUpdater, type AcknowledgedPreferencesPort } from '../../settings/application/acknowledgedPreferences';
import { changeWorkspaceNavigation, parseWorkspaceNavigation, type NavigationChange, type WorkspaceNavigation } from '../domain/navigation';

/** Global chrome and host tab placement share save/reload semantics, never resource ownership. */
export function createNavigationUpdater(port: AcknowledgedPreferencesPort<WorkspaceNavigation>): (action: NavigationChange) => Promise<void> {
    return createAcknowledgedPreferencesUpdater(port, {
        parse: parseWorkspaceNavigation,
        prepare: action => {
            if (action.type !== 'restore') return { ...action };
            const value = parseWorkspaceNavigation(action.value);
            const expected = parseWorkspaceNavigation(action.expected);
            return value && expected ? { type: 'restore', value, expected } : null;
        },
        change: changeWorkspaceNavigation,
        invalid: 'Choose supported navigation preferences.',
        unsupported: 'Navigation preferences use an unsupported format. Review settings.json before changing them.',
        superseded: 'Navigation was saved, but settings changed while saving. Reload settings to see the current choices.',
    });
}
