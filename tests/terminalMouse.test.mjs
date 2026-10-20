import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadWorkspaceDomain } from './helpers/loadWorkspaceDomain.mjs';

const { normalizeTerminalRightClickAction, resolveTerminalRightClick } = loadWorkspaceDomain('lib/terminal/terminalMousePolicy.ts');

test('missing and unsupported mouse settings keep the existing context menu', () => {
    for (const value of [undefined, null, '', false, {}, 'future-mode', 'context-menu']) {
        assert.equal(normalizeTerminalRightClickAction(value), 'context-menu');
        assert.equal(resolveTerminalRightClick({ rightClickAction: value }, true, false), 'menu');
    }
});

test('the merged automatic mode never copies implicitly; Shift always opens the menu', () => {
    for (const action of ['context-menu', 'auto', 'paste', 'passthrough']) {
        for (const tracking of [false, true]) for (const copyOnSelect of [false, true]) {
            const preferences = { rightClickAction: action, copyOnSelect };
            const expected = action === 'context-menu' ? 'menu'
                : tracking ? 'pass' : 'paste';
            assert.equal(resolveTerminalRightClick(preferences, tracking, false), expected);
            assert.equal(resolveTerminalRightClick(preferences, tracking, true), 'menu');
        }
    }
    for (const legacy of ['paste', 'passthrough']) assert.equal(normalizeTerminalRightClickAction(legacy), 'auto');
});
