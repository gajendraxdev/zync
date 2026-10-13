import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Select } from '../.tmp-agent-tests/src/components/ui/Select.js';
import { TopbarDropdown } from '../.tmp-agent-tests/src/components/ui/TopbarDropdown.js';
import { MenuSubmenu, MENU_PANEL_CLASS } from '../.tmp-agent-tests/src/components/ui/MenuSubmenu.js';
import { POPUP_SURFACE_CLASSES } from '../.tmp-agent-tests/src/components/ui/surfaceStyles.js';
import { loadSource } from './helpers/loadSource.mjs';
import * as jsx from 'react/jsx-runtime';
import * as React from 'react';
import { Check } from 'lucide-react';
import { moveMenuFocus } from '../.tmp-agent-tests/src/components/ui/menuFocus.js';

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const options = [{ value: 'sh', label: 'Shell' }, { value: 'bash', label: 'Bash' }];
const onChange = () => assert.fail('Rendering must not change selection');

test('Select retains label, selection and native non-submit semantics', () => {
  const html = render(Select, { id: 'shell', label: 'Shell type', ariaDescribedBy: 'help', value: 'bash', options, onChange });
  assert.match(html, /for="shell"/);
  assert.match(html, /id="shell"/);
  assert.match(html, /type="button"/);
  assert.match(html, /aria-describedby="help"/);
  assert.match(html, /aria-haspopup="listbox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />Bash<\/span>/);
});

test('Select retains disabled accessible trigger and unknown-value fallback', () => {
  const html = render(Select, { ariaLabel: 'Choose shell', disabled: true, value: 'missing', placeholder: 'Choose one', options, onChange });
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-label="Choose shell"/);
  assert.match(html, /disabled=""/);
  assert.match(html, />Choose one<\/span>/);
});

test('Select keeps caller trigger sizing and radius overrides', () => {
  const html = render(Select, { options, onChange, triggerClassName: 'h-7 rounded-none text-xs' });
  assert.match(html, /h-7/);
  assert.match(html, /rounded-none/);
  assert.doesNotMatch(html, /h-\[var\(--zync-control-height/);
  assert.doesNotMatch(html, /rounded-\[var/);
});

test('TopbarDropdown retains caller alignment, placement, width and element attributes', () => {
  const html = render(TopbarDropdown, { align: 'right', side: 'top', widthClass: 'w-64', className: 'rounded-none', role: 'menu', 'aria-label': 'Actions', children: 'Item' });
  assert.match(html, /right-0/);
  assert.match(html, /bottom-full/);
  assert.match(html, /w-64/);
  assert.match(html, /role="menu"/);
  assert.match(html, /aria-label="Actions"/);
  assert.match(html, /rounded-none/);
  assert.doesNotMatch(html, /rounded-\[var/);
});

test('TopbarDropdown opens without animation or animated placement in either direction', () => {
  for (const side of ['top', 'bottom']) {
    const html = render(TopbarDropdown, { side, children: 'Item' });
    assert.match(html, /transition-none/);
    assert.doesNotMatch(html, /animate-in|fade-in|slide-in|duration-200/);
  }
});

test('submenu and other popups share visual tokens without merging placement ownership', () => {
  assert.ok(MENU_PANEL_CLASS.includes(POPUP_SURFACE_CLASSES));
  assert.ok(MENU_PANEL_CLASS.includes('fixed'));
  const html = render(MenuSubmenu, { label: 'More actions', disabled: true, triggerClassName: 'h-7', children: createElement('button', null, 'Child') });
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, />Child</);
});

test('context-menu initial focus is opt-in and cannot scroll its containing page', () => {
  for (const autoFocus of [false, true]) {
    const effects = [], focused = [];
    const control = { focus: options => focused.push(options) };
    const root = { querySelector: selector => { assert.equal(selector, 'button:not(:disabled)'); return control; } };
    const { ContextMenu } = loadSource('components/ui/ContextMenu.tsx', {
      react: { useEffect: effect => effects.push(effect), useLayoutEffect: () => {}, useRef: () => ({ current: root }), useState: initial => [initial, () => {}] },
      'react/jsx-runtime': jsx, 'react-dom': { createPortal: content => content },
      '../../lib/utils.js': { cn: (...values) => values.filter(Boolean).join(' ') },
      './MenuSubmenu': { isInsideMenu: () => false, MENU_PANEL_CLASS: '', MenuSubmenu: () => null },
      './surfaceStyles': { MENU_ITEM_CLASSES: '' },
      'lucide-react': { Check }, './menuFocus': { moveMenuFocus },
    }, { document: { body: {} }, window: { innerHeight: 800, innerWidth: 1280 } });
    ContextMenu({ x: 1, y: 1, items: [], onClose: () => {}, autoFocus });
    effects[0]();
    assert.deepEqual(JSON.parse(JSON.stringify(focused)), autoFocus ? [{ preventScroll: true }] : []);
  }
});

test('checked context-menu rows announce visibility/position and expose display-only shortcuts', () => {
  let actions = 0;
  const { ContextMenu } = loadSource('components/ui/ContextMenu.tsx', {
    react: React, 'react/jsx-runtime': jsx, 'react-dom': { createPortal: content => content },
    'lucide-react': { Check }, './menuFocus': { moveMenuFocus },
    '../../lib/utils.js': { cn: (...values) => values.filter(Boolean).join(' ') },
    './MenuSubmenu': { isInsideMenu: () => false, MENU_PANEL_CLASS: '', MenuSubmenu: () => null },
    './surfaceStyles': { MENU_ITEM_CLASSES: '' },
  }, { document: { body: {} }, window: { innerHeight: 800, innerWidth: 1280 } });
  const html = render(ContextMenu, { x: 1, y: 1, className: 'w-72', ariaLabel: 'Navigation options', onClose() {}, items: [
    { label: 'Hosts', checked: true, shortcut: 'Ctrl+Alt+1', action: () => actions++ },
    { label: 'Snippets', checked: false, action: () => actions++ },
    { label: 'Right', checked: true, checkType: 'radio', action: () => actions++ },
    { label: 'Settings', checked: true, disabled: true, action: () => actions++ },
    { label: 'Customize', action: () => actions++ },
  ] });
  assert.match(html, /role="menu" aria-label="Navigation options"/);
  assert.match(html, /role="menuitemcheckbox" aria-checked="false"/);
  assert.match(html, /role="menuitemradio" aria-checked="true"/);
  assert.match(html, /role="menuitemcheckbox" aria-checked="true" disabled=""/);
  assert.match(html, /role="menuitem"/);
  assert.match(html, /ml-auto shrink-0 pl-3 text-xs text-app-muted">Ctrl\+Alt\+1/);
  assert.match(html, /w-72/);
  assert.equal(actions, 0, 'rendering hints or checked state cannot execute commands');
});

test('shared menu keyboard navigation wraps, skips disabled rows and ignores nested layers', () => {
  let active = null;
  const plain = value => JSON.parse(JSON.stringify(value));
  class Element { constructor(owner) { this.owner = owner; } closest() { return this.owner; } }
  const options = [];
  const panel = { querySelectorAll: selector => { assert.equal(selector, 'button:not(:disabled)'); return rows; } };
  const rows = [0, 1, 2].map(() => ({ closest: () => panel, focus() {} }));
  // Native disabled rows are excluded by the selector; nested owners are filtered separately.
  for (const [index, row] of rows.entries()) row.focus = value => { active = index; options.push(plain(value)); };
  rows.push({ closest: () => ({}), focus() { assert.fail('Cannot focus a nested menu row'); } });
  const { moveMenuFocus: move } = loadSource('components/ui/menuFocus.ts', {}, {
    Element, document: { get activeElement() { return rows[active]; } },
  });
  const event = key => ({ key, target: new Element(panel), defaultPrevented: false, preventDefault() {}, stopPropagation() {} });
  move(panel, event('ArrowDown')); assert.equal(active, 0);
  move(panel, event('ArrowUp')); assert.equal(active, 2);
  move(panel, event('ArrowDown')); assert.equal(active, 0);
  move(panel, event('End')); assert.equal(active, 2);
  move(panel, event('Home')); assert.equal(active, 0);
  move(panel, { ...event('ArrowDown'), target: new Element({}) }); assert.equal(active, 0);
  move(panel, { ...event('ArrowDown'), defaultPrevented: true }); assert.equal(active, 0);
  move(panel, event('Enter')); assert.equal(active, 0);
  assert.ok(options.every(value => value.preventScroll));
});
