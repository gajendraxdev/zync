import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSource } from './helpers/loadSource.mjs';

const jsx = (type, props) => ({ type, props });
const pluginContext = { usePlugins: () => ({ loaded: true,
    panels: [{ id: 'owner:panel', pluginId: 'owner', html: '', legacyAccess: false }],
    plugins: [{ manifest: { id: 'owner', permissions: { required: [{ id: 'ssh.exec' }] } } }],
}) };
const state = { connections: [{ id: 'remote', status: 'disconnected' }], terminals: {},
    connect: () => {}, openConnectionModal: () => {} };
const { PluginPanel } = loadSource('components/plugins/PluginPanel.tsx', {
    react: {}, 'react/jsx-runtime': { jsx, jsxs: jsx }, '@tauri-apps/api/core': {},
    '../../store/useAppStore': { useAppStore: selector => selector(state) },
    '../../lib/themePayload': {}, '../../lib/debugFlags': {},
    '../../features/plugins/confirmPluginTerminalAction': {}, '../../features/plugins/pluginCommandBridge': {},
    '../../features/plugins/runtime/paneMessages': {}, '../../features/plugins/usePluginPaneDocument': {},
    '../../context/PluginContext': pluginContext,
    '../../features/shortcuts/pluginShortcuts': {}, '../../features/shortcuts/actions': {},
    '../terminal/TerminalDisconnectedView': { TerminalDisconnectedView: 'Disconnected' }, './PluginTerminalLayer': {},
});
const { FeaturePaneBody } = loadSource('components/terminal/FeaturePaneBody.tsx', {
    react: { lazy: () => 'LazyPane', Suspense: 'Suspense' }, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '../ErrorBoundary': {}, '../../context/PluginContext': pluginContext, '../plugins/PluginUnavailable': {},
});

test('disconnected plugin interaction follows renderer focus and visibility, not center selection', () => {
    for (const focused of [false, true]) for (const visible of [false, true]) {
        const body = FeaturePaneBody({ connectionId: 'remote', pluginId: 'owner:panel', instanceId: 'instance', focused, visible });
        const plugin = body.props.children.find(child => child?.props?.paneInstanceId === 'instance');
        assert.ok(plugin, 'feature body renders the registered plugin');
        assert.equal(plugin.props.focused, focused);
        const disconnected = PluginPanel(plugin.props);
        assert.equal(disconnected.type, 'Disconnected');
        assert.equal(disconnected.props.isSurfaceActive, focused && visible);
    }
});
