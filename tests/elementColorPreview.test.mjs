import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ElementColorPreview } from '../.tmp-agent-tests/src/features/appearance/presentation/ElementColorPreview.js';
import { ELEMENT_COLOR_AREAS, ELEMENT_COLOR_KEYS } from '../.tmp-agent-tests/src/features/appearance/domain/elementColors.js';
import { ELEMENT_COLOR_BINDINGS } from '../.tmp-agent-tests/src/features/appearance/presentation/elementColorBindings.js';

const render = (area, colors = {}) => renderToStaticMarkup(createElement(ElementColorPreview, { area, colors }));

test('every area has a contextual sample workspace, with no focusable or live resource controls', () => {
    for (const area of ELEMENT_COLOR_AREAS) {
        const html = render(area);
        assert.match(html, /role="img" aria-label="Area preview:/);
        assert.match(html, /Sample workspace/);
        for (const region of ['mainTabs', 'navigation', 'sidebar', 'contentTabs', 'statusBar']) assert.ok(html.includes(`data-preview-area="${region}"`), region);
        assert.doesNotMatch(html, /<(?:button|input|select|textarea|iframe|canvas|a)\b|tabindex=|data-zync-color=/i);
        assert.match(html, /data-zync-color-protected="true"/);
    }
});

test('all registered roles affect the relevant sample, including active tabs, hover, cursor and selection', () => {
    for (const key of ELEMENT_COLOR_KEYS) {
        const area = key.split('.')[0];
        const html = render(area, { [key]: '#123456' });
        assert.ok(html.includes('#123456'), `Missing visual role: ${key}`);
        assert.equal((html.match(/#123456/g) ?? []).length,
            area === 'paneHeader' || area === 'control' || key === 'panel.border' ? 2 : 1, key);
    }
    const terminal = render('terminal', { 'terminal.cursor': '#123456', 'terminal.selectionBackground': '#abcdef' });
    assert.match(terminal, /data-preview-cursor="true"[^>]*background-color:#123456/);
    assert.match(terminal, /data-preview-selection="true"[^>]*background-color:#abcdef/);
    assert.match(render('navigation', { 'navigation.hoverBackground': '#abcdef' }), /data-preview-hover="navigation"[^>]*background-color:#abcdef/);
});

test('panel/control previews use files; headers use an actual split sample, not a pane tab stack', () => {
    for (const area of ['panel', 'control']) {
        const html = render(area);
        assert.match(html, /\/home\/demo\/project/);
        assert.match(html, /README.md/);
        assert.match(html, /New folder/);
        assert.doesNotMatch(html, /data-preview-area="terminal"/);
    }
    const split = render('paneHeader');
    assert.match(split, /2 panes/);
    assert.equal((split.match(/data-preview-area="paneHeader"/g) ?? []).length, 2);
    assert.equal((split.match(/data-preview-area="contentTabs"/g) ?? []).length, 1);
});

test('missing/invalid colors use shared production tokens without mutating the supplied palette', () => {
    const colors = Object.freeze({ 'mainTabs.background': 'url(secret)', 'terminal.cursor': '#fff' });
    const html = render('mainTabs', colors);
    assert.doesNotMatch(html, /url\(secret\)|background-color:#fff;/);
    assert.ok(html.includes(`background-color:var(${ELEMENT_COLOR_BINDINGS['mainTabs.background'].fallback})`));
    assert.ok(html.includes(`background-color:var(${ELEMENT_COLOR_BINDINGS['terminal.cursor'].fallback})`));
    assert.equal(colors['mainTabs.background'], 'url(secret)');
});
