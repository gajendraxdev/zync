import assert from 'node:assert/strict';
import { SHORTCUT_CATALOG } from '../.tmp-agent-tests/src/features/shortcuts/catalog.js';
import { shortcutBindings, shortcutBindingLabel, shortcutConflicts, shortcutBindingIssue, recordedShortcut, canonicalShortcut } from '../.tmp-agent-tests/src/features/shortcuts/bindings.js';
import { RECOMMENDED_TERMINAL_SHORTCUT_EXCEPTIONS, DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS, normalizeKeyboardSettings } from '../.tmp-agent-tests/src/features/shortcuts/policy.js';
import { pluginShortcutBindings } from '../.tmp-agent-tests/src/features/shortcuts/pluginShortcuts.js';
import { shortcutHint } from '../.tmp-agent-tests/src/features/shortcuts/labels.js';
import { matchShortcut } from '../.tmp-agent-tests/src/lib/shortcuts.js';

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'Win32' } });
const command = id => SHORTCUT_CATALOG.find(row => row.id === id);
const palette = command('commandPaletteMode'), split = command('splitPanes');
assert.deepEqual(shortcutBindings(palette, {}), ['Mod+Shift+P']);
assert.deepEqual(shortcutBindings(palette, { commandPaletteMode: '' }), []);
assert.equal(shortcutBindingLabel(palette, { commandPaletteMode: 'Mod+Alt+K' }), 'Ctrl+Alt+K');
assert.equal(shortcutBindingLabel(palette, { commandPaletteMode: '' }), 'Not set');
assert.equal(shortcutHint('toggleSidebar', {}), 'Ctrl+B / Ctrl+Shift+B');
assert.equal(shortcutHint('toggleSidebar', { toggleSidebar: '', toggleSidebarAlternative: '' }), undefined);
assert.equal(shortcutHint('commandPaletteMode', { commandPaletteMode: '' }), undefined);
assert.deepEqual(shortcutBindings(split, { splitPanes: '' }), []);
assert.equal(shortcutBindings(split, { splitPanes: 'Mod+Alt+J' }).length, 4, 'fixed aliases remain visible and active on remap');
assert.ok(shortcutBindingLabel(split, { splitPanes: 'Mod+Alt+J' }).includes('Ctrl+Shift+Down'));
assert.ok(pluginShortcutBindings({ focusSplitPane: '' }, false).every(row => row.id !== 'focusSplitPane'), 'removal applies across the iframe bridge without broadening its authority');

assert.equal(canonicalShortcut('Ctrl+Alt+1', false), canonicalShortcut('Alt+Mod+1', false));
assert.equal(canonicalShortcut('Command+K', true), canonicalShortcut('Mod+K', true));
assert.notEqual(canonicalShortcut('Ctrl+K', true), canonicalShortcut('Mod+K', true));
assert.equal(canonicalShortcut('Ctrl+Shift+1', false), canonicalShortcut('Ctrl+Shift+!', false));
assert.equal(canonicalShortcut('Alt+Left', false), canonicalShortcut('Alt+ArrowLeft', false));
assert.ok(shortcutConflicts(palette, { commandPaletteMode: 'Ctrl+B' }, SHORTCUT_CATALOG).some(row => row.id === 'toggleSidebar'));
assert.ok(shortcutConflicts(palette, { commandPaletteMode: 'Ctrl+Shift+ArrowDown' }, SHORTCUT_CATALOG).some(row => row.id === 'splitPanes'), 'alternate keys take part in conflict checks');
assert.ok(shortcutConflicts(palette, { commandPaletteMode: 'Ctrl+Shift+S' }, SHORTCUT_CATALOG).some(row => row.id === 'snippetsFeature'), 'hidden built-ins take part in conflict checks');
assert.equal(shortcutConflicts(palette, { commandPaletteMode: '' }, SHORTCUT_CATALOG).length, 0);
assert.equal(shortcutConflicts(command('termCopy'), { termCopy: 'Mod+C' }, [command('termCopy'), command('fmCopy')]).length, 0, 'file and terminal clipboard scopes are distinct');
assert.ok(shortcutBindingIssue(palette, 'Ctrl+B', {}, SHORTCUT_CATALOG));
assert.ok(shortcutBindingIssue(palette, 'A', {}, SHORTCUT_CATALOG));
assert.ok(shortcutBindingIssue(palette, 'Shift+A', {}, SHORTCUT_CATALOG), 'Shift alone must not turn typing into a global command');
assert.equal(shortcutBindingIssue(palette, '', {}, SHORTCUT_CATALOG), undefined, 'removal is always available to resolve a conflict');
assert.equal(shortcutBindingIssue(palette, 'Mod+Alt+K', {}, SHORTCUT_CATALOG), undefined);
assert.ok(shortcutBindingIssue(command('focusSplitPane'), 'Mod+Alt+K', {}, SHORTCUT_CATALOG), 'directional focus cannot record a key its action cannot interpret');
assert.equal(shortcutBindingIssue(command('focusSplitPane'), 'Mod+Shift+ArrowRight', {}, [command('focusSplitPane')]), undefined);
assert.equal(shortcutConflicts(command('termFind'), {}, SHORTCUT_CATALOG).length, 0, 'terminal Find and file Find have distinct actual owners');
assert.equal(shortcutBindingIssue(command('fmOpen'), 'Enter', {}, [command('fmOpen')]), undefined);

assert.deepEqual(DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS, ['commandPaletteMode', 'snippetsFeature'], 'upgrade defaults do not silently take over additional shell keys');
assert.ok(RECOMMENDED_TERMINAL_SHORTCUT_EXCEPTIONS.includes('navigationHosts'));
assert.ok(RECOMMENDED_TERMINAL_SHORTCUT_EXCEPTIONS.includes('switchTabNext'));
assert.ok(RECOMMENDED_TERMINAL_SHORTCUT_EXCEPTIONS.includes('closeTerminalTab'));
for (const row of SHORTCUT_CATALOG.filter(row => row.actionId)) {
  assert.ok(SHORTCUT_CATALOG.some(target => target.id === row.actionId && !target.actionId), 'alternatives point directly to an existing action');
  assert.equal(shortcutConflicts(row, {}, SHORTCUT_CATALOG).length, 0, 'new alternative has no default catalog collision');
  assert.deepEqual(shortcutBindings(row, { [row.settingsKey]: '' }), [], 'each alternative can be independently removed');
}
assert.ok(!RECOMMENDED_TERMINAL_SHORTCUT_EXCEPTIONS.includes('termFind'), 'Ctrl+F remains shell editing unless explicitly reserved');
assert.deepEqual(normalizeKeyboardSettings({ secondaryShortcutsVersion: 1, terminalShortcutExceptions: ['navigationHosts', 'navigationHosts', 'fmCopy', 'invalid'] }).terminalShortcutExceptions, ['navigationHosts']);
assert.ok(SHORTCUT_CATALOG.filter(row => row.when === 'files' || row.terminalUtility).every(row => !row.terminalReservation));

const event = extra => ({ key: 'k', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, getModifierState: () => false, ...extra });
assert.equal(recordedShortcut(event({}), false), 'Mod+K');
assert.equal(recordedShortcut(event({ ctrlKey: true, metaKey: true }), true), 'Mod+Ctrl+K', 'Mac Command and physical Control are retained independently');
assert.equal(recordedShortcut(event({ ctrlKey: false, metaKey: true }), false), 'Meta+K');
assert.equal(recordedShortcut(event({ isComposing: true }), false), undefined);
assert.equal(recordedShortcut(event({ getModifierState: key => key === 'AltGraph' }), false), undefined);
assert.equal(matchShortcut(event({ key: ' ' }), 'Mod+Space'), true, 'recorded Space tokens match real events');
console.log('Effective bindings, aliases, disable/reset semantics, hybrid presets, scoped conflicts and recorder guards passed.');
