import { createAcknowledgedPreferencesUpdater, type AcknowledgedPreferencesPort, type PreferencesQueue } from '../../settings/application/acknowledgedPreferences';
import { CUSTOM_THEME_ID, parseThemeDocument, parseThemeSettings, type ThemeDocument, type ThemeSettingsSnapshot } from '../domain/themeDocument';

/** Apply all theme-owned fields as one acknowledged native transaction, never four partial saves. */
export function createThemeImportUpdater(port: AcknowledgedPreferencesPort<ThemeSettingsSnapshot>, schedule?: PreferencesQueue) {
    return createAcknowledgedPreferencesUpdater<ThemeSettingsSnapshot, ThemeDocument>(port, {
        parse: parseThemeSettings,
        prepare: parseThemeDocument,
        change: (_current, theme) => ({ theme: CUSTOM_THEME_ID, accentColor: null, customTheme: theme, elementColors: theme.elements }),
        invalid: 'Invalid Zync theme.',
        unsupported: 'Current theme/color preferences use an unsupported format. They have not been replaced.',
        superseded: 'Theme was saved, but settings changed before confirmation. Reload settings before applying again.',
    }, schedule);
}
