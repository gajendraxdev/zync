import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const manager = read('src/components/FileManager.tsx');
const store = read('src/store/terminalSlice.ts');
const connections = read('src/store/connectionSlice.ts');
const layout = read('src/components/layout/MainLayout.tsx');
const tabs = read('src/components/layout/WorkspaceTabBar.tsx');

assert.match(manager, /registerPaneCloseBlocker\(scope, editorCloseToken\.current\)/,
  'a dirty file editor must register a close blocker for its pane');
assert.match(store, /closePaneGroup:[\s\S]*?isPaneLayoutCloseBlocked\(connectionId, layout\)/,
  'closing a group must respect every contained pane blocker');
assert.match(store, /closePaneInSplit:[\s\S]*?isPaneCloseBlocked\(paneCloseScope\(connectionId, node\.content\)\)/,
  'closing one split pane must check only that pane for unsaved content');
assert.match(layout, /if \(!store\.closePaneInSplit\(tab\.connectionId, pane\.id\)\) return;/,
  'feature tabs must remain open when pane close is blocked');
assert.match(layout, /if \(!store\.closePaneGroup\(tab\.connectionId, owner\)\) return;[\s\S]*?setFeatureTabs\(remainingFeatureTabs\)/,
  'group tabs must not be removed before the guarded close succeeds');
assert.match(tabs, /if \(!closePaneInSplit\(connectionId, focused\.id\)\) return;/,
  'undocking must stop when a dirty editor blocks pane removal');
assert.match(connections, /closeTab:[\s\S]*?isPaneLayoutCloseBlocked\(connectionId, layout\)/,
  'closing a connection tab must respect its unsaved pane editors');

console.log('Pane close editor guard test passed.');
