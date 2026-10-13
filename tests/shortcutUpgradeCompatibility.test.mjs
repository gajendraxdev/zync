import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHORTCUT_CATALOG } from '../.tmp-agent-tests/src/features/shortcuts/catalog.js';
import { resolveShortcutBindings, shortcutBindings, shortcutBindingIssue, shortcutBindingWarning } from '../.tmp-agent-tests/src/features/shortcuts/bindings.js';
import { routeShortcut } from '../.tmp-agent-tests/src/features/shortcuts/route.js';
import { normalizeKeyboardSettings } from '../.tmp-agent-tests/src/features/shortcuts/policy.js';
import { shortcutHint } from '../.tmp-agent-tests/src/features/shortcuts/labels.js';
import { pluginShortcutBindings, matchPluginShortcut } from '../.tmp-agent-tests/src/features/shortcuts/pluginShortcuts.js';

const command = id => SHORTCUT_CATALOG.find(row => row.id === id);
const materializedDefaults = Object.fromEntries(SHORTCUT_CATALOG.filter(row => row.settingsKey)
    .map(row => [row.settingsKey, row.defaultKeys]));
const event = (key, isMac, extra = {}) => ({ type: 'keydown', key,
    ctrlKey: !isMac, metaKey: isMac, altKey: false, shiftKey: false,
    repeat: false, isComposing: false, defaultPrevented: false, getModifierState: () => false, ...extra });
const dispatch = (key, overrides, focus, keyboard) => {
    const actions = [];
    routeShortcut(key, focus, keyboard.terminalFocusPolicy, SHORTCUT_CATALOG, overrides,
        id => { actions.push(id); return true; }, keyboard.terminalShortcutExceptions);
    return actions;
};

for (const isMac of [false, true]) {
    const platform = isMac ? 'macOS' : 'Windows/Linux';
    const selectPlatform = () => Object.defineProperty(globalThis, 'navigator', {
        configurable: true, value: { platform: isMac ? 'MacIntel' : 'Win32' },
    });

    test(`${platform}: upgraded custom Settings binding wins over a new navigation default`, () => {
        selectPlatform();
        const overrides = Object.freeze({ ...materializedDefaults, toggleSettings: 'Mod+Alt+3' });
        const before = JSON.stringify(overrides);
        const keyboard = normalizeKeyboardSettings({ terminalFocusPolicy: 'shell', terminalShortcutExceptions: [] });
        assert.deepEqual(dispatch(event('3', isMac, { altKey: true }), overrides, 'app', keyboard), ['toggleSettings']);
        assert.deepEqual(dispatch(event('3', isMac, { altKey: true }), overrides, 'xterm', { ...keyboard, terminalFocusPolicy: 'app' }), ['toggleSettings']);
        assert.deepEqual(resolveShortcutBindings(command('navigationPublicUrls'), overrides, SHORTCUT_CATALOG).active, []);
        assert.equal(shortcutBindings(command('navigationPublicUrls'), overrides)[0], 'Mod+Alt+3', 'the default remains configured');
        assert.match(shortcutBindingWarning(command('navigationPublicUrls'), overrides, SHORTCUT_CATALOG), /Inactive:.*Settings/);
        assert.match(shortcutBindingWarning(command('toggleSettings'), overrides, SHORTCUT_CATALOG), /custom shortcut takes priority/);
        assert.equal(shortcutHint('navigationPublicUrls', overrides), isMac ? '⌘⇧U' : 'Ctrl+Shift+U', 'the non-conflicting secondary hint remains');
        assert.equal(JSON.stringify(overrides), before, 'resolution never migrates or rewrites saved bindings');
    });

    test(`${platform}: an automatic secondary never changes an unreserved custom key's terminal owner`, () => {
        selectPlatform();
        const overrides = { ...materializedDefaults, commandPalette: 'Mod+Shift+B' };
        const keyboard = normalizeKeyboardSettings({ terminalFocusPolicy: 'shell', terminalShortcutExceptions: [] });
        assert.ok(keyboard.terminalShortcutExceptions.includes('toggleSidebarAlternative'), 'automatic adoption is retained');
        const key = () => event('b', isMac, { shiftKey: true });
        assert.deepEqual(dispatch(key(), overrides, 'xterm', keyboard), [], 'the custom key still passes through to the PTY');
        assert.deepEqual(dispatch(key(), overrides, 'app', keyboard), ['commandPalette']);
        assert.deepEqual(dispatch(key(), overrides, 'xterm', { ...keyboard, terminalFocusPolicy: 'app' }), ['commandPalette']);
        assert.deepEqual(dispatch(key(), overrides, 'xterm', { ...keyboard,
            terminalShortcutExceptions: [...keyboard.terminalShortcutExceptions, 'commandPalette'] }), ['commandPalette']);
        assert.deepEqual(resolveShortcutBindings(command('toggleSidebarAlternative'), overrides, SHORTCUT_CATALOG).active, []);
        assert.equal(shortcutHint('toggleSidebar', overrides), isMac ? '⌘B' : 'Ctrl+B');
    });

    test(`${platform}: non-conflicting secondary defaults remain automatic in both app and terminal`, () => {
        selectPlatform();
        const keyboard = normalizeKeyboardSettings({ terminalFocusPolicy: 'shell', terminalShortcutExceptions: [] });
        for (const row of SHORTCUT_CATALOG.filter(row => row.actionId)) {
            const parts = row.defaultKeys.split('+');
            const key = parts.at(-1) === 'Space' ? ' ' : parts.at(-1).toLowerCase();
            const input = () => event(key, isMac, { shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt') });
            assert.deepEqual(dispatch(input(), materializedDefaults, 'app', keyboard), [row.id]);
            assert.deepEqual(dispatch(input(), materializedDefaults, 'xterm', keyboard), [row.id]);
        }
    });

    test(`${platform}: reset and removal revive defaults without overwriting another custom binding`, () => {
        selectPlatform();
        const overrides = { ...materializedDefaults, toggleSettings: 'Mod+Alt+3' };
        const publicUrls = command('navigationPublicUrls');
        assert.equal(shortcutBindingIssue(publicUrls, publicUrls.defaultKeys, overrides, SHORTCUT_CATALOG), undefined,
            'Reset can restore an inactive default without replacing the custom owner');
        const resetDefault = { ...overrides, navigationPublicUrls: publicUrls.defaultKeys };
        assert.deepEqual(resolveShortcutBindings(publicUrls, resetDefault, SHORTCUT_CATALOG).active, []);
        assert.equal(resetDefault.toggleSettings, overrides.toggleSettings);
        for (const value of ['', command('toggleSettings').defaultKeys]) {
            const released = { ...resetDefault, toggleSettings: value };
            assert.deepEqual(resolveShortcutBindings(publicUrls, released, SHORTCUT_CATALOG).active, [publicUrls.defaultKeys]);
        }
        const alternatives = { ...materializedDefaults, commandPalette: 'Mod+Shift+B' };
        const resetPrimary = { ...alternatives, commandPalette: command('commandPalette').defaultKeys };
        assert.deepEqual(resolveShortcutBindings(command('toggleSidebarAlternative'), resetPrimary, SHORTCUT_CATALOG).active, ['Mod+Shift+B']);
        assert.equal(shortcutBindingIssue(command('commandPalette'), alternatives.commandPalette, alternatives, SHORTCUT_CATALOG), undefined,
            'an existing remap is not rejected merely because an upgrade added a default');
    });

    test(`${platform}: plugin hints and interception share conflict resolution without gaining authority`, () => {
        selectPlatform();
        const overrides = { commandPalette: 'Mod+Shift+B', newHostTerminal: 'Mod+Shift+Space' };
        const bindings = pluginShortcutBindings(overrides, isMac);
        const key = (name, extra = {}) => ({ ...event(name, isMac, extra), code: '', inField: false });
        assert.equal(matchPluginShortcut(key('b', { shiftKey: true }), bindings), 'commandPalette');
        assert.equal(matchPluginShortcut(key(' ', { shiftKey: true }), bindings), null,
            'a protected host command prevents the inherited plugin palette alias from claiming its key');
        assert.ok(!bindings.some(binding => binding.id === 'newHostTerminal'));
        assert.equal(shortcutHint('commandPalette', overrides), isMac ? '⌘⇧B' : 'Ctrl+Shift+B');
    });
}

test('scope and fixed-alias rules preserve only the conflicting inherited chord', () => {
    const split = command('splitPanes');
    const overrides = { splitPanes: 'Mod+Alt+ArrowRight', toggleSettings: 'Ctrl+Shift+ArrowDown' };
    const resolved = resolveShortcutBindings(split, overrides, SHORTCUT_CATALOG, false);
    assert.ok(resolved.active.includes(overrides.splitPanes));
    assert.ok(!resolved.active.includes(overrides.toggleSettings), 'fixed aliases do not gain custom priority with their remapped primary');
    assert.ok(resolved.active.includes('Ctrl+Shift+ArrowUp'));
    assert.match(shortcutBindingWarning(command('toggleSettings'), overrides, SHORTCUT_CATALOG, false), /custom shortcut takes priority/,
        'a displaced fixed alias is not misreported as a conflict between two active custom primaries');
    const files = { fmCopy: 'Mod+Shift+C' };
    assert.deepEqual(resolveShortcutBindings(command('termCopy'), files, SHORTCUT_CATALOG, false).active, ['Mod+Shift+C'],
        'disjoint File Manager and terminal scopes do not suppress each other');
});

test('canonical platform modifiers and shifted digits protect equivalent custom chords', () => {
    const overrides = { toggleSettings: 'Control+Alt+3' };
    assert.deepEqual(resolveShortcutBindings(command('navigationPublicUrls'), overrides, SHORTCUT_CATALOG, false).active, []);
    assert.deepEqual(resolveShortcutBindings(command('navigationPublicUrls'), overrides, SHORTCUT_CATALOG, true).active, ['Mod+Alt+3'],
        'physical Control and macOS Command are distinct');
    const shifted = { toggleSettings: 'Ctrl+Shift+!' };
    assert.deepEqual(resolveShortcutBindings(command('fmListView'), shifted, SHORTCUT_CATALOG, false).active, []);
});

test('two existing custom remaps remain visible conflicts rather than being rewritten', () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'Win32' } });
    const overrides = Object.freeze({ toggleSettings: 'Mod+Alt+K', commandPalette: 'Mod+Alt+K' });
    for (const id of ['toggleSettings', 'commandPalette']) {
        assert.deepEqual(resolveShortcutBindings(command(id), overrides, SHORTCUT_CATALOG).active, ['Mod+Alt+K']);
        assert.match(shortcutBindingWarning(command(id), overrides, SHORTCUT_CATALOG), /Overlapping binding/);
    }
    assert.deepEqual(dispatch(event('k', false, { altKey: true }), overrides, 'app', normalizeKeyboardSettings(undefined)), ['toggleSettings'],
        'existing catalog order only resolves ambiguity between two explicit custom choices');
});
