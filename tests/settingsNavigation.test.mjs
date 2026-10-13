import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import rehypeRaw from 'rehype-raw';
import { SETTINGS_SECTIONS, SettingsNavigation, nextSettingsSection, settingsPanelId, settingsTabId } from '../.tmp-agent-tests/src/components/settings/SettingsNavigation.js';

/** Walk parsed HTML, independent of wrapper tags, whitespace and sibling order. */
const descendants = node => [node, ...(node.children ?? []).flatMap(descendants)];
const textContent = node => descendants(node).filter(child => child.type === 'text').map(child => child.value).join('');

function assertJsonActionOutsideTablist(html) {
  const tree = rehypeRaw()({ type: 'root', children: [{ type: 'raw', value: html }] });
  const nodes = descendants(tree);
  const tablists = nodes.filter(node => node.properties?.role === 'tablist');
  const jsonButtons = nodes.filter(node => node.tagName === 'button' && textContent(node).trim() === 'settings.json');
  assert.equal(tablists.length, 1, 'expected one settings tablist');
  assert.equal(jsonButtons.length, 1, 'expected one settings.json button');
  assert.ok(!descendants(tablists[0]).includes(jsonButtons[0]), 'settings.json must be outside the tablist');
}

test('vertical section navigation wraps and supports Home/End', () => {
  assert.equal(nextSettingsSection('general', 'ArrowDown'), 'terminal');
  assert.equal(nextSettingsSection('general', 'ArrowUp'), 'about');
  assert.equal(nextSettingsSection('about', 'ArrowDown'), 'general');
  assert.equal(nextSettingsSection('feedback', 'Home'), 'general');
  assert.equal(nextSettingsSection('terminal', 'End'), 'about');
  assert.equal(new Set(SETTINGS_SECTIONS.map(section => section.key)).size, SETTINGS_SECTIONS.length);
});

test('Tab, activation keys and horizontal arrows retain native behavior', () => {
  for (const key of ['Tab', 'Enter', ' ', 'Escape', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(nextSettingsSection('general', key), undefined);
  }
});

test('only the selected tab and the separate JSON action start in the Tab sequence', () => {
  const html = renderToStaticMarkup(h(SettingsNavigation, {
    idPrefix: 'settings', activeTab: 'terminal',
    onTabChange: () => assert.fail('render must not change sections'),
    onOpenJson: () => assert.fail('render must not open JSON'), aboutBadge: true, aboutBadgeLabel: 'Update ready',
  }));
  assert.match(html, /role="tablist" aria-label="Settings sections" aria-orientation="vertical"/);
  const tabs = html.match(/<button[^>]*role="tab"[^>]*>/g);
  assert.equal(tabs.length, 10);
  assert.equal(tabs.filter(tab => tab.includes('tabindex="0"')).length, 1);
  assert.ok(tabs.find(tab => tab.includes(`id="${settingsTabId('settings', 'terminal')}"`)).includes('aria-selected="true"'));
  assert.ok(tabs.every(tab => tab.includes(`aria-controls="${settingsPanelId('settings')}"`)));
  assert.match(html, /Update ready/);
  assertJsonActionOutsideTablist(html);
});

test('JSON placement assertion tolerates wrappers and siblings but rejects nested actions', () => {
  const action = '<button type="button"><span>settings.json</span></button>';
  const list = '<nav role="tablist"><button role="tab">General</button></nav>';
  assertJsonActionOutsideTablist(`<main>${list}<footer>${action}</footer><p>More content</p></main>`);
  assertJsonActionOutsideTablist(`<main>${action}${list}</main>`);
  assert.throws(() => assertJsonActionOutsideTablist(`<nav role="tablist"><section>${action}</section></nav>`),
    /settings\.json must be outside the tablist/);
});
