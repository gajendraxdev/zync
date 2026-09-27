import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';

const source = readFileSync('src/components/layout/retainedItems.ts', 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { retainLiveItems } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

let retained = retainLiveItems(['one', 'two', 'unvisited'], new Set(), 'one');
assert.deepEqual([...retained], ['one']);
retained = retainLiveItems(['one', 'two', 'unvisited'], retained, 'two');
assert.deepEqual([...retained], ['one', 'two'], 'Switching retains the previous pane');
retained = retainLiveItems(['two', 'unvisited'], retained, 'two');
assert.deepEqual([...retained], ['two'], 'Closing disposes the old pane');
retained = retainLiveItems(['one', 'two', 'unvisited'], retained, null);
assert.deepEqual([...retained], ['two'], 'Reopening an inactive item does not resurrect closed state');
assert.deepEqual([...retainLiveItems([], retained, null)], []);

const frame = readFileSync('src/components/plugins/PluginPanel.tsx', 'utf8');
assert.match(frame, /useLayoutEffect\(\(\) => \{\s+visibleRef.current = visible;\s+\}, \[visible\]\)/, 'Visibility refs update only after commit');
assert.equal(frame.match(/visibleRef.current = visible/g)?.length, 1);
const layout = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');
assert.doesNotMatch(layout, /paneInstanceId=\{`overlay:/, 'Plugin tabs render through the shared pane canvas');
assert.match(layout, /ensurePluginPane/, 'Restored plugin tabs receive persisted pane identities');
assert.match(frame, /PluginPanelFrame key=\{frameKey\}/, 'Connection or pane identity changes recreate the frame');
assert.match(frame, /event.source !== window.parent/);
assert.match(frame, /typeof data.visible !== 'boolean'/);
assert.match(frame, /sendVisibility\(\);\s+sendTheme\(\)/);
assert.match(frame, /sandbox=\{legacyAccess \? 'allow-scripts allow-modals' : 'allow-scripts'\}/);
assert.match(frame, /connect-src 'none'/);
const shim = frame.match(/<script>\s*let paneVisible = false;([\s\S]*?)<\/script>/)?.[0];
assert.ok(shim);
const listeners = new Set();
const parent = {};
const window = {
    parent,
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener),
};
runInNewContext(shim.replace(/<\/?script>/g, ''), { window });
const visibility = [];
const unsubscribe = window.zync.pane.onVisibilityChange(value => visibility.push(value));
const emit = (source, visible) => listeners.forEach(listener => listener({ source, data: { type: 'zync:pane:visibility', visible } }));
emit({}, false);
emit(parent, 'false');
assert.deepEqual(visibility, [false], 'Stay hidden until a valid host confirmation');
emit(parent, false);
emit(parent, false);
assert.equal(window.zync.pane.isVisible(), false);
emit(parent, true);
assert.deepEqual(visibility, [false, true], 'Only publish actual transitions');
unsubscribe();
emit(parent, false);
assert.deepEqual(visibility, [false, true], 'Unsubscribed listeners are disposed');
assert.match(layout, /\(\) => tabs.map\(tab => tab.id\)/, 'All live tabs participate regardless of connection identity');
const connectionFree = retainLiveItems(['settings', 'host'], new Set(['settings']), 'host');
assert.deepEqual([...connectionFree], ['settings', 'host']);
console.log('Pane retention, disposal and visibility boundary tests passed.');
