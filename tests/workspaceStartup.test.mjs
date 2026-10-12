import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Test the production effect, isolating only platform/store calls so it cannot
// open real tabs, consume an updater flag or persist settings during a test.
const source = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');
const ast = ts.createSourceFile('MainLayout.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let versionEffect;
function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
        && node.arguments[0]?.getText(ast).includes('const checkVersionAndShowNotes = async')) {
        versionEffect = node.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(versionEffect, 'Release-note startup effect must have an explicit readiness boundary');

test('release notes cannot mutate workspace or version tracking before session restore completes', async () => {
    let opened = 0;
    let nativeCalls = 0;
    const updates = [];
    const versionChecked = { current: false };
    const previousVersion = { current: '' };
    const globals = {
        isLoadingSettings: false, sessionLoaded: false, versionChecked,
        surveyPreviousVersionRef: previousVersion,
        useAppStore: { getState: () => ({ settings: { lastSeenVersion: 'old-version' } }) },
        window: { ipcRenderer: { invoke: async () => { nativeCalls++; return 'new-version'; } } },
        localStorage: { getItem: () => null, removeItem: () => assert.fail('No updater flag to consume') },
        openReleaseNotesTab: () => { opened++; },
        updateSettings: update => updates.push(update),
        console,
    };
    runInNewContext(`(${versionEffect})()`, globals);
    assert.equal(versionChecked.current, false);
    assert.equal(previousVersion.current, '');
    assert.equal(nativeCalls, 0);
    assert.equal(opened, 0);
    assert.equal(updates.length, 0);
    globals.sessionLoaded = true;
    runInNewContext(`(${versionEffect})()`, globals);
    // Drain the cross-realm native-Promise continuation, not just this realm's queue.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(versionChecked.current, true);
    assert.equal(previousVersion.current, 'old-version');
    assert.equal(nativeCalls, 1);
    assert.equal(opened, 1);
    assert.equal(updates[0].lastSeenVersion, 'new-version');
    runInNewContext(`(${versionEffect})()`, globals);
    assert.equal(opened, 1);
});
