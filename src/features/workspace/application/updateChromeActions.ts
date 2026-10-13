import { createAcknowledgedPreferencesUpdater, type AcknowledgedPreferencesPort } from '../../settings/application/acknowledgedPreferences';
import { changeChromeActions, parseChromeActions, prepareChromeActionChange, type ChromeActionPreferences, type ChromeActionChange } from '../domain/chromeActions';

/** Persist bounded chrome choices without changing command or content lifecycle ownership. */
export function createChromeActionUpdater(port: AcknowledgedPreferencesPort<ChromeActionPreferences>): (action: ChromeActionChange) => Promise<void> {
    return createAcknowledgedPreferencesUpdater(port, {
        parse: parseChromeActions, prepare: prepareChromeActionChange, change: changeChromeActions,
        invalid: 'Choose a supported toolbar or status action.',
        unsupported: 'Toolbar and status preferences use an unsupported format. Review settings.json before changing them.',
        superseded: 'The preferences were saved, but settings changed while saving. Reload settings to see the current choices.',
    });
}
