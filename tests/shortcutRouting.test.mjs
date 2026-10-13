import assert from 'node:assert/strict';
import { SHORTCUT_CATALOG } from '../.tmp-agent-tests/src/features/shortcuts/catalog.js';
import { routeShortcut } from '../.tmp-agent-tests/src/features/shortcuts/route.js';
import { normalizeKeyboardSettings, DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS, TERMINAL_SHORTCUT_EXCEPTION_IDS } from '../.tmp-agent-tests/src/features/shortcuts/policy.js';
import { routeTerminalKey } from '../.tmp-agent-tests/src/lib/terminal/terminalKeyRouting.js';

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: 'Win32' } });
const key = (name, extra = {}) => ({
  type: 'keydown', key: name, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, defaultPrevented: false, getModifierState: () => false,
  preventDefault() { this.defaultPrevented = true; }, ...extra,
});
const actions = [];
const route = (event, policy = 'shell', focus = 'xterm', overrides = {}, exceptions = DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS) => routeShortcut(
  event, focus, policy, SHORTCUT_CATALOG, overrides, id => { actions.push(id); return true; }, exceptions,
);

const secondaryIds = SHORTCUT_CATALOG.filter(row => row.actionId && row.terminalReservation).map(row => row.id);
const defaults = { terminalFocusPolicy: 'shell', terminalShortcutExceptions: ['commandPaletteMode', 'snippetsFeature', ...secondaryIds], secondaryShortcutsVersion: 1 };
assert.deepEqual(normalizeKeyboardSettings(undefined), defaults);
assert.deepEqual(normalizeKeyboardSettings({ terminalFocusPolicy: 'bad' }), defaults);
assert.deepEqual(normalizeKeyboardSettings({ terminalFocusPolicy: 'app' }), { ...defaults, terminalFocusPolicy: 'app' });
assert.deepEqual(normalizeKeyboardSettings({ terminalShortcutExceptions: [] }).terminalShortcutExceptions, secondaryIds, 'legacy profiles automatically receive only secondary reservations');
assert.deepEqual(normalizeKeyboardSettings({ terminalShortcutExceptions: 'all' }), defaults);
assert.deepEqual(normalizeKeyboardSettings({ terminalShortcutExceptions: ['snippetsFeature', 'snippetsFeature', 'termCopy', 'fmCopy', 'unknown', null] }).terminalShortcutExceptions, ['snippetsFeature', ...secondaryIds]);
assert.deepEqual(normalizeKeyboardSettings(JSON.parse(JSON.stringify({ ...defaults, terminalShortcutExceptions: [] }))).terminalShortcutExceptions, [], 'disabled exceptions survive reload');
assert.deepEqual(normalizeKeyboardSettings(JSON.parse(JSON.stringify({ ...defaults, terminalShortcutExceptions: ['filesFeature'] }))).terminalShortcutExceptions, ['filesFeature'], 'custom choices survive reload');
assert.notEqual(normalizeKeyboardSettings(undefined).terminalShortcutExceptions, normalizeKeyboardSettings(undefined).terminalShortcutExceptions, 'default lists are not shared mutable state');
for (const id of TERMINAL_SHORTCUT_EXCEPTION_IDS) {
  assert.ok(SHORTCUT_CATALOG.some(command => command.id === id && command.terminalReservation
    && ['always', 'app', 'xterm'].includes(command.when)), 'every exception maps to an eligible named app command');
}
for (const event of [key('b'), key('p'), key('i'), key('t'), key('w'), key('f'), key(','), key('1'),
  key('Tab'), key('ArrowRight', { shiftKey: true }), key('ArrowLeft', { altKey: true }),
  key('t', { shiftKey: true }), key('='), key('-')]) {
  assert.equal(route(event), false, `${event.key} belongs to terminal in shell-first`);
  assert.equal(route(event, 'app'), true, `${event.key} belongs to Zync in app-first`);
}
actions.length = 0;
assert.equal(route(key('p', { shiftKey: true })), true);
assert.equal(route(key('s', { shiftKey: true })), true);
assert.deepEqual(actions, ['commandPaletteMode', 'snippetsFeature']);
assert.equal(route(key('s', { shiftKey: true, repeat: true })), true);
assert.equal(actions.length, 2, 'reserved app toggles do not repeat');
assert.equal(route(key('`', { shiftKey: true })), true, 'existing Snippets aliases follow the exception');
assert.equal(route(key('~', { shiftKey: true }), 'shell', 'xterm', {}, []), false, 'disabling Snippets also disables its aliases');
assert.equal(route(key('s', { shiftKey: true }), 'shell', 'xterm', {}, []), false);
assert.equal(route(key('p', { shiftKey: true }), 'shell', 'xterm', {}, []), false);
assert.equal(route(key('s', { shiftKey: true }), 'app', 'xterm', {}, []), true, 'app-first is unaffected by exception selection');
assert.equal(route(key('s', { shiftKey: true }), 'shell', 'app', {}, []), true, 'exception choices do not disable app-chrome shortcuts');
assert.equal(route(key('f', { shiftKey: true })), false, 'no blanket Ctrl+Shift interception');
assert.equal(route(key('f', { shiftKey: true }), 'shell', 'xterm', {}, ['filesFeature']), true);
assert.equal(route(key('b'), 'shell', 'xterm', {}, ['toggleSidebar']), true, 'sidebar can be explicitly reserved');
assert.equal(route(key('c'), 'shell', 'xterm', {}, ['termCopy', 'terminalInterrupt']), false, 'invented IDs cannot reserve Ctrl+C');
assert.equal(route(key('1', { altKey: true }), 'shell', 'xterm', {}, ['navigationHosts']), true, 'app-scoped navigation supports hybrid ownership');
assert.equal(route(key('1', { altKey: true }), 'shell', 'field', {}, ['navigationHosts']), false, 'a reservation does not broaden editable-field scope');
assert.equal(route(key('1', { altKey: true }), 'shell', 'xterm', {}, []), false, 'unreserved navigation passes through');
assert.equal(route(key('q'), 'shell', 'xterm', { navigationHosts: 'Mod+Q' }, ['navigationHosts']), true, 'reservations use customized keys');
assert.equal(route(key('ArrowDown', { shiftKey: true }), 'shell', 'xterm', { splitPanes: '' }, ['splitPanes']), false, 'removing a command disables its fixed aliases');
assert.equal(route(key('p', { shiftKey: true }), 'shell', 'xterm', { commandPaletteMode: '' }), false, 'a removed reserved shortcut does not fall back to default');
assert.equal(route(key('c', { shiftKey: true }), 'shell', 'xterm', {}, []), true, 'clipboard remains available with app exceptions disabled');
assert.equal(route(key('v', { shiftKey: true }), 'shell', 'xterm', {}, []), true);
actions.length = 0;
assert.equal(route(key('c')), false, 'Ctrl+C stays interrupt');
assert.equal(route(key('b', { repeat: true })), false, 'terminal repeats pass through');
assert.equal(route(key('c', { shiftKey: true })), true);
assert.equal(route(key('v', { shiftKey: true })), true);
assert.deepEqual(actions, ['termCopy', 'termPaste']);
assert.equal(route(key('v', { shiftKey: true }), 'shell', 'field'), false, 'no paste into background shell from a field');
assert.equal(route(key('b'), 'shell', 'app'), true, 'app chrome remains usable');
assert.equal(route(key('b'), 'app', 'xterm', { toggleSidebar: 'Mod+Q' }), false, 'remap replaces primary binding');
assert.equal(route(key('q'), 'app', 'xterm', { toggleSidebar: 'Mod+Q' }), true);
assert.equal(route(key('q'), 'shell', 'xterm', { toggleSidebar: 'Mod+Q' }), false);

for (const flags of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true },
  { getModifierState: modifier => modifier === 'AltGraph' }, { key: 'Dead' }, { type: 'keyup' }]) {
  assert.equal(route(key('b', flags), 'app'), false, 'composition/consumed/non-keydown does not run app action');
  assert.equal(route(key('s', { shiftKey: true, ...flags })), false, 'reserved commands also respect composition and consumed events');
}
actions.length = 0;
assert.equal(route(key('b'), 'app'), true);
assert.equal(route(key('b', { repeat: true }), 'app'), true);
assert.deepEqual(actions, ['toggleSidebar'], 'held toggle acts once and does not leak repeats to terminal');
assert.equal(route(key('=', { repeat: true }), 'app'), true);
assert.equal(actions.at(-1), 'zoomIn', 'zoom allows repeats');

const writes = [];
const slash = key('/');
assert.equal(routeTerminalKey(slash, data => writes.push(data)), false);
assert.deepEqual(writes, ['\x1f']);
assert.equal(slash.defaultPrevented, true);
assert.equal(routeTerminalKey(key('/', { defaultPrevented: true }), data => writes.push(data)), false);
assert.equal(routeTerminalKey(key('/', { isComposing: true }), data => writes.push(data)), true);
assert.equal(writes.length, 1, 'consumed app chord never writes again');

navigator.platform = 'MacIntel';
assert.equal(route(key('b'), 'app'), false, 'physical Ctrl+B is not Command+B on macOS');
assert.equal(route(key('b', { ctrlKey: false, metaKey: true }), 'app'), true);
assert.equal(route(key('b', { ctrlKey: false, metaKey: true })), false);
assert.equal(route(key('p', { ctrlKey: false, metaKey: true, shiftKey: true })), true, 'reserved Mod+Shift+P uses Command on macOS');
assert.equal(route(key('p', { shiftKey: true })), false, 'physical Ctrl+Shift+P remains terminal input on macOS');
assert.equal(route(key('s', { shiftKey: true })), true, 'existing explicit Ctrl+Shift+S stays physical Ctrl');
console.log('Shortcut ownership, overrides, repeats, IME/AltGraph and PTY boundary tests passed.');

navigator.platform = 'Win32';
const alternativeOnly = ['toggleSidebarAlternative'];
actions.length = 0;
assert.equal(route(key('b'), 'shell', 'xterm', {}, alternativeOnly), false, 'reserving the alternative preserves shell Ctrl+B');
assert.equal(route(key('b', { shiftKey: true }), 'shell', 'xterm', {}, alternativeOnly), true);
assert.deepEqual(actions, ['toggleSidebarAlternative']);
assert.equal(route(key('b', { shiftKey: true }), 'shell', 'xterm', {}, ['toggleSidebar']), false, 'primary reservation does not reserve its alternative');
assert.equal(route(key('b', { shiftKey: true }), 'shell', 'xterm', { toggleSidebarAlternative: '' }, alternativeOnly), false);
assert.equal(route(key('q', { shiftKey: true }), 'shell', 'xterm', { toggleSidebarAlternative: 'Mod+Shift+Q' }, alternativeOnly), true);
assert.equal(route(key('b', { shiftKey: true }), 'shell', 'xterm', { toggleSidebar: '' }, alternativeOnly), true, 'removing the primary does not remove an independent alternative');

// Automatic adoption is idempotent and does not make secondary keys terminal-only.
const upgraded = normalizeKeyboardSettings({ terminalFocusPolicy: 'shell', terminalShortcutExceptions: [] });
assert.deepEqual(normalizeKeyboardSettings(upgraded), upgraded);
for (const platform of ['Win32', 'MacIntel']) {
  navigator.platform = platform;
  const modifiers = { ctrlKey: platform === 'Win32', metaKey: platform === 'MacIntel' };
  for (const policy of ['shell', 'app']) {
    assert.equal(route(key('p', modifiers), policy, 'app', {}, upgraded.terminalShortcutExceptions), true);
    assert.equal(route(key(' ', { ...modifiers, shiftKey: true }), policy, 'app', {}, upgraded.terminalShortcutExceptions), true);
    assert.equal(route(key(' ', { ...modifiers, shiftKey: true }), policy, 'xterm', {}, upgraded.terminalShortcutExceptions), true);
    assert.equal(route(key('p', modifiers), policy, 'xterm', {}, upgraded.terminalShortcutExceptions), policy === 'app');
  }
}
