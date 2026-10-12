import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconButton } from '../.tmp-agent-tests/src/components/ui/IconButton.js';
import { PanelHeader } from '../.tmp-agent-tests/src/components/ui/PanelHeader.js';
import { Toolbar } from '../.tmp-agent-tests/src/components/ui/Toolbar.js';
import { StateMessage } from '../.tmp-agent-tests/src/components/ui/StateMessage.js';

const icon = h('svg', { 'data-fixture-icon': true });
const render = (component, props) => renderToStaticMarkup(h(component, props));

test('empty state text does not create a live region or a focus stop', () => {
  const html = render(StateMessage, { variant: 'empty', children: 'No panes yet.' });
  assert.match(html, /^<p /);
  assert.match(html, /text-app-muted/);
  assert.doesNotMatch(html, /role=|aria-live=|tabindex=|autofocus=|variant=/);
});

test('state messages share announcement semantics without implicit focus or actions', () => {
  for (const [variant, role, color] of [['error', 'alert', 'text-control-danger'], ['status', 'status', 'text-app-muted']]) {
    const html = render(StateMessage, { variant, children: 'Result' });
    assert.match(html, new RegExp(`role="${role}"`));
    assert.ok(html.includes(color));
    assert.doesNotMatch(html, /aria-live=|tabindex=|autofocus=|<button/);
  }
});

test('state messages escape text and preserve explicit native attributes and class overrides', () => {
  const html = render(StateMessage, { variant: 'status', children: '<untrusted>', id: 'saved', tabIndex: -1,
    'aria-describedby': 'layout-hint', className: 'text-xs mt-3' });
  assert.match(html, /&lt;untrusted&gt;/);
  assert.match(html, /id="saved" tabindex="-1" aria-describedby="layout-hint"/);
  assert.match(html, /min-w-0 break-words/);
  assert.match(html, /text-xs mt-3/);
  assert.doesNotMatch(html, /text-sm/);
});

test('icon actions retain their accessible name without generating a duplicate title', () => {
  const html = render(IconButton, { label: 'Close settings', icon, 'aria-controls': 'settings' });
  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="Close settings"/);
  assert.doesNotMatch(html, /\stitle=/);
  assert.match(html, /aria-controls="settings"/);
  assert.match(html, /aria-hidden="true"/);
});

test('icon actions preserve explicit type, tooltip, toggled state and caller sizing', () => {
  const html = render(IconButton, { label: 'Pin', icon, type: 'submit', title: 'Pin tab', 'aria-pressed': true, className: 'h-7 w-7 rounded-none' });
  assert.match(html, /type="submit"/);
  assert.match(html, /title="Pin tab"/);
  assert.match(html, /aria-label="Pin"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /h-7 w-7 rounded-none/);
  assert.doesNotMatch(html, /[hw]-\[var\(/);
});

test('icon actions preserve an explicitly empty title without falling back to the label', () => {
  const html = render(IconButton, { label: 'Close', icon, title: '' });
  assert.match(html, /title=""/);
  assert.match(html, /aria-label="Close"/);
});

test('loading icon action retains its name, is disabled and replaces its decorative icon', () => {
  const html = render(IconButton, { label: 'Refresh', icon, isLoading: true });
  assert.match(html, /aria-label="Refresh"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /data-fixture-icon/);
});

test('panel headers preserve heading identity, semantics and supplied actions', () => {
  const html = render(PanelHeader, { title: 'Settings', titleId: 'dialog-title', headingLevel: 3, icon, description: 'Preferences', actions: h(IconButton, { label: 'Close', icon }) });
  assert.match(html, /<h3 id="dialog-title"/);
  assert.match(html, />Settings<\/h3>/);
  assert.match(html, /Preferences/);
  assert.match(html, /aria-label="Close"/);
  assert.match(html, /flex-wrap/);
});

test('panel headers support empty action slots, escaped titles and caller overrides', () => {
  const html = render(PanelHeader, { title: '<untrusted>', className: 'px-2', titleClassName: 'text-lg' });
  assert.match(html, /&lt;untrusted&gt;/);
  assert.doesNotMatch(html, /ml-auto|<button/);
  assert.match(html, /px-2/);
  assert.doesNotMatch(html, /px-4/);
});

test('toolbar names a native-tab-order group without inventing composite keyboard behavior', () => {
  const html = render(Toolbar, { label: 'Snippet actions', className: 'gap-2', children: h(IconButton, { label: 'Edit', icon }) });
  assert.match(html, /role="group" aria-label="Snippet actions"/);
  assert.doesNotMatch(html, /role="toolbar"|tabindex=/);
  assert.match(html, /flex-wrap/);
  assert.match(html, /gap-2/);
  assert.doesNotMatch(html, /gap-\[var/);
});
