import { createAcknowledgedPreferencesUpdater, type AcknowledgedPreferencesPort, type PreferencesQueue } from '../../settings/application/acknowledgedPreferences';
import { changeElementColors, parseElementColors, prepareElementColorChange, type ElementColors, type ElementColorChange } from '../domain/elementColors';

/** Store only validated semantic colors; theme/application effects remain presentation-owned. */
export function createElementColorUpdater(port: AcknowledgedPreferencesPort<ElementColors>, schedule?: PreferencesQueue): (action: ElementColorChange) => Promise<void> {
    return createAcknowledgedPreferencesUpdater(port, {
        parse: parseElementColors,
        prepare: prepareElementColorChange,
        change: changeElementColors,
        invalid: 'Choose a supported element and a six-digit hex color.',
        unsupported: 'Element colors use an unsupported format. Review settings.json before changing them.',
        superseded: 'Element colors were saved, but settings changed while saving. Reload settings to see the current colors.',
    }, schedule);
}
