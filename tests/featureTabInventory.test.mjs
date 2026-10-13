import assert from 'node:assert/strict';
import { resolvePluginPanelOwner } from '../.tmp-agent-tests/src/features/plugins/pluginPanelOwner.js';
import { singleFeaturePane, singlePane, splitPane } from '../.tmp-agent-tests/src/lib/paneLayout/index.js';
import {
  featureTabsFromPaneGroups,
  preferredFeatureTabId,
  pluginTabInventory,
  stablePluginPanelInventory,
} from '../.tmp-agent-tests/src/components/layout/featureTabInventory.js';

assert.deepEqual(pluginTabInventory([], ['plugin:pm2'], 'plugin:pm2'), ['plugin:pm2']);
assert.deepEqual(pluginTabInventory([], [], 'plugin:pm2'), ['plugin:pm2']);
assert.deepEqual(pluginTabInventory(['plugin:pm2', 'files'], ['plugin:pm2', 'plugin:editor'], 'terminal'), ['plugin:pm2', 'plugin:editor']);
assert.deepEqual(pluginTabInventory([], [], 'terminal'), []);
const installedPlugin = { manifest: { id: 'com.zync.pm2', contributes: { paneKinds: [{ id: 'pm2', title: 'PM2 Monitor', entry: 'private.html' }] } } };
assert.deepEqual(stablePluginPanelInventory([], [installedPlugin]), [{ id: 'com.zync.pm2:pm2', title: 'PM2 Monitor', allowMultiple: false, pluginId: 'com.zync.pm2' }]);
assert.deepEqual(stablePluginPanelInventory([{ id: 'com.zync.pm2:pm2', title: 'Active title', html: 'never copy this' }], [installedPlugin]), [{ id: 'com.zync.pm2:pm2', title: 'Active title', allowMultiple: false, pluginId: 'com.zync.pm2' }]);
assert.deepEqual(stablePluginPanelInventory([{ id: 'legacy:id', pluginId: 'owner', title: 'Runtime', allowMultiple: true }], []), [{ id: 'legacy:id', pluginId: 'owner', title: 'Runtime', allowMultiple: true }]);
assert.deepEqual(stablePluginPanelInventory([], [{ manifest: { id: 'owner', contributes: { paneKinds: [{ id: 'pane', title: 'Declared', allowMultiple: true }] } } }]), [{ id: 'owner:pane', pluginId: 'owner', title: 'Declared', allowMultiple: true }]);
assert.equal(stablePluginPanelInventory([], [installedPlugin, { manifest: { id: 'other', contributes: installedPlugin.manifest.contributes } }]).length, 2, 'Different plugins may use the same local pane id');
assert.deepEqual(stablePluginPanelInventory([], []), []);
assert.equal(resolvePluginPanelOwner('com.zync.pm2:pm2', [], [installedPlugin]), 'com.zync.pm2', 'Stopped plugin panes keep their icon owner');
assert.equal(resolvePluginPanelOwner('com.zync.pm2:pm2', [{ id: 'com.zync.pm2:pm2', pluginId: 'registered' }], [installedPlugin]), 'registered', 'Registered owner takes precedence');
assert.equal(resolvePluginPanelOwner('com.zync.pm2', [], [installedPlugin]), 'com.zync.pm2', 'Direct plugin IDs retain their fallback');
assert.equal(resolvePluginPanelOwner('unknown:pane', [], [installedPlugin]), 'unknown:pane', 'Unknown panels retain the original fallback');

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('returning to a host reuses the saved Files pane', () => {
  const groups = {
    'files-a': singleFeaturePane('files', 'pane-files', 'files-a'),
  };
  const savedLayout = groups['files-a'];
  const first = featureTabsFromPaneGroups(groups);
  const second = featureTabsFromPaneGroups(groups);
  assert.deepEqual(first, [{ id: 'files-a', featureId: 'files', instanceId: 'files-a' }]);
  assert.deepEqual(second, first);
  assert.equal(preferredFeatureTabId(first, 'files', groups, 'files-a'), 'files-a');
  assert.equal(preferredFeatureTabId(second, 'files', groups, 'files-a'), 'files-a');
  assert.equal(groups['files-a'], savedLayout, 'Projection must not replace canonical content');
});

runTest('an empty host has no feature tab or selection to synthesize', () => {
  for (const groups of [{}, null, undefined]) {
    const tabs = featureTabsFromPaneGroups(groups);
    assert.deepEqual(tabs, []);
    assert.equal(preferredFeatureTabId(tabs, 'files', groups, null), null);
  }
});

runTest('several saved Files panes come back without an extra tab', () => {
  const groups = {
    'files-a': singleFeaturePane('files', 'pane-a', 'files-a'),
    'files-b': singleFeaturePane('files', 'pane-b', 'files-b'),
  };
  const tabs = featureTabsFromPaneGroups(groups);
  assert.deepEqual(tabs.map(tab => tab.id), ['files-a', 'files-b']);
  assert.equal(preferredFeatureTabId(tabs, 'files', groups, 'files-a'), 'files-a');
});

runTest('the active Files group restores its matching tab', () => {
  const groups = {
    'files-a': singleFeaturePane('files', 'pane-a', 'files-a'),
    'files-b': singleFeaturePane('files', 'pane-b', 'files-b'),
  };
  const tabs = featureTabsFromPaneGroups(groups);
  assert.equal(preferredFeatureTabId(tabs, 'files', groups, 'files-b'), 'files-b');
});

runTest('mixed canonical content keeps only existing feature instances in the inventory', () => {
  const groups = {
    'term-1': singlePane('term-1', 'pane-term'),
    'files-a': singleFeaturePane('files', 'pane-files', 'files-a'),
    'dashboard-a': singleFeaturePane('dashboard', 'pane-dashboard', 'dashboard-a'),
  };
  const tabs = featureTabsFromPaneGroups(groups);
  assert.deepEqual(tabs.map(tab => tab.id), ['files-a', 'dashboard-a']);
  assert.equal(preferredFeatureTabId(tabs, 'files', groups, 'dashboard-a'), 'files-a');
  assert.equal(preferredFeatureTabId(tabs, 'snippets', groups, 'dashboard-a'), null);
});

runTest('canonical projection deduplicates repeated instance ids deterministically', () => {
  const groups = {
    'files-a': singleFeaturePane('files', 'pane-files', 'files-a'),
    'duplicate-owner': singleFeaturePane('files', 'pane-duplicate', 'files-a'),
  };
  assert.deepEqual(featureTabsFromPaneGroups(groups), [
    { id: 'files-a', featureId: 'files', instanceId: 'files-a' },
  ]);
});

runTest('closed panes disappear instead of surviving in a merged local inventory', () => {
  const first = singleFeaturePane('files', 'pane-a', 'files-a');
  const second = singleFeaturePane('files', 'pane-b', 'files-b');
  const before = featureTabsFromPaneGroups({ 'files-a': first, 'files-b': second });
  const remainingGroups = { 'files-b': second };
  const after = featureTabsFromPaneGroups(remainingGroups);
  assert.deepEqual(before.map(tab => tab.id), ['files-a', 'files-b']);
  assert.deepEqual(after.map(tab => tab.id), ['files-b']);
  assert.equal(preferredFeatureTabId(after, 'files', remainingGroups, 'files-a'), 'files-b');
  assert.deepEqual(featureTabsFromPaneGroups({}), []);
  assert.equal(remainingGroups['files-b'], second);
});

runTest('a terminal-owned split keeps its Files tab over a later Files pane', () => {
  const split = splitPane(
    singlePane('term-1', 'pane-term'),
    'pane-term',
    'horizontal',
    { kind: 'feature', featureId: 'files', instanceId: 'files-a' },
  );
  assert.equal(split.ok, true);
  if (!split.ok) return;
  const groups = {
    'term-1': split.layout,
    'files-b': singleFeaturePane('files', 'pane-b', 'files-b'),
  };
  const tabs = featureTabsFromPaneGroups(groups);
  assert.deepEqual(tabs.map(tab => tab.id), ['files-a', 'files-b']);
  assert.equal(preferredFeatureTabId(tabs, 'files', groups, 'term-1'), 'files-a');
});

runTest('the last Files tab is used when the active group has no Files pane', () => {
  const groups = {
    'term-1': singlePane('term-1', 'pane-term'),
    'files-a': singleFeaturePane('files', 'pane-a', 'files-a'),
    'files-b': singleFeaturePane('files', 'pane-b', 'files-b'),
  };
  const tabs = featureTabsFromPaneGroups(groups);
  for (const owner of ['term-1', 'stale-owner', null, undefined]) {
    assert.equal(preferredFeatureTabId(tabs, 'files', groups, owner), 'files-b');
  }
});

runTest('a Files pane inside a split is still one tab', () => {
  const split = splitPane(
    singleFeaturePane('files', 'pane-files', 'files-a'),
    'pane-files',
    'horizontal',
    { kind: 'term', termId: 'term-1' },
  );
  assert.equal(split.ok, true);
  if (!split.ok) return;
  const tabs = featureTabsFromPaneGroups({ 'files-a': split.layout });
  assert.deepEqual(tabs.map(tab => tab.id), ['files-a']);
});

runTest('legacy feature leaves remain canonical without inventing an instance identity', () => {
  const legacy = singleFeaturePane('files', 'legacy-pane');
  const groups = { workspace: legacy };
  assert.deepEqual(featureTabsFromPaneGroups(groups), []);
  assert.equal(legacy.root.content.instanceId, undefined);
  assert.equal(groups.workspace, legacy);
});
