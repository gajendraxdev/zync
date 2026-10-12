import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSource } from './helpers/loadSource.mjs';
import * as jsxRuntime from 'react/jsx-runtime';

const plain = value => JSON.parse(JSON.stringify(value));
const plugin = { path: '/test/plugin', manifest: { id: 'test.plugin', name: 'Test plugin', version: '1.0.0' }, enabled: true };
const release = { id: plugin.manifest.id, name: plugin.manifest.name, version: '2.0.0', registryVerified: true };
const inspection = { inspectionId: 'review-one', packageDigest: 'digest', manifest: plugin.manifest };

// Execute the real controller with explicit hook/IPC boundaries, never the native app.
function harness({ enabled = true, confirm = true, runtime = true, loadFails = false, registryFails = false } = {}) {
    const slots = [], effects = [], calls = [], toasts = [];
    let cursor = 0, result, pendingInspect;
    const hooks = {
        useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
        },
        useEffect(effect, deps) {
            const index = cursor++;
            const previous = slots[index];
            if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
            slots[index] = { deps, cleanup: previous?.cleanup };
            effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
        },
    };
    const invoke = async (command, args) => {
        calls.push([command, plain(args ?? {})]);
        if (command === 'plugins:load') { if (loadFails) throw Error('test load failure'); return [plugin]; }
        if (command === 'plugins:registry_load') { if (registryFails) throw Error('test registry failure'); return { plugins: [release], revocations: [] }; }
        if (command === 'plugins:beta_plugins_get') return [];
        if (command === 'plugins:inspect_marketplace') return pendingInspect ? pendingInspect : inspection;
        if (command === 'plugins:install_inspected') return { activationId: 'activation-one', pluginId: plugin.manifest.id };
        if (command === 'plugins:commit_activation') return true;
    };
    const { usePluginManagement } = loadSource('features/plugins/presentation/usePluginManagement.ts', {
        react: hooks, '@tauri-apps/plugin-dialog': { open: async () => null },
        '../pluginCommandBridge': { filterUnsupportedHostThemes: value => value },
        '../marketplace/releases': { selectMarketplaceReleases: value => value },
        '../management/pluginManagement': {
            uninstallPlugin: async (...args) => { calls.push(['uninstall', plain(args)]); return {}; },
            clearPluginStorage() {}, rollbackPluginVersion() {}, setPluginOptionalPermissions() {},
        },
    }, { window: { ipcRenderer: { invoke } }, AbortController, DOMException, console: { error() {}, info() {} },
        fetch: async () => { throw Error('test network unavailable'); } });
    const options = { enabled, loadDeveloperOptions: false, showToast: (...args) => toasts.push(args),
        showConfirmDialog: async value => { calls.push(['confirm', value]); return confirm; },
        reloadPluginRuntime: async id => { calls.push(['runtime', id]); return runtime; } };
    const render = () => { cursor = 0; result = usePluginManagement(options); while (effects.length) effects.shift()(); return result; };
    const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); return render(); };
    render();
    return { render, settle, calls, toasts, options, get: () => result,
        deferInspection: promise => { pendingInspect = promise; },
        unmount: () => slots.forEach(slot => slot.cleanup?.()) };
}

test('browsing loads metadata only; disabled surfaces do no IPC', async () => {
    const subject = harness(); await subject.settle();
    assert.deepEqual(subject.calls.map(([command]) => command), ['plugins:load', 'plugins:registry_load', 'plugins:beta_plugins_get']);
    assert.equal(subject.get().plugins[0], plugin); assert.deepEqual(plain(subject.get().selectedRegistry[0]), release);
    const dormant = harness({ enabled: false }); await dormant.settle(); assert.deepEqual(dormant.calls, []);
});

test('enable/disable uses the existing native toggle and reloads the runtime', async () => {
    const subject = harness(); await subject.settle(); subject.calls.length = 0;
    await subject.get().handleTogglePlugin(plugin.manifest.id, false); await subject.settle();
    assert.deepEqual(subject.calls, [['plugins:toggle', { id: plugin.manifest.id, enabled: false }], ['runtime', undefined]]);
    assert.equal(subject.get().plugins[0].enabled, false);
});

test('uninstall requires confirmation and preserves private data by default', async () => {
    for (const confirm of [false, true]) {
        const subject = harness({ confirm }); await subject.settle(); subject.calls.length = 0;
        await subject.get().handleUninstallPlugin(plugin, false);
        assert.equal(subject.calls[0][0], 'confirm');
        assert.deepEqual(subject.calls.filter(([command]) => command === 'uninstall'), confirm ? [['uninstall', [plugin.manifest.id, false]]] : []);
    }
});

test('marketplace rejects unsigned/revoked entries and approval stays explicit', async () => {
    const subject = harness(); await subject.settle(); subject.calls.length = 0;
    for (const row of [{ ...release, registryVerified: false }, { ...release, revokedReason: 'Revoked signing key' }]) {
        await subject.get().handleInspectMarketplacePlugin(row);
    }
    assert.deepEqual(subject.calls, []);
    await subject.get().handleInspectMarketplacePlugin(release); await subject.settle();
    assert.deepEqual(subject.calls.map(([command]) => command), ['plugins:inspect_marketplace']);
    assert.equal(subject.get().pendingPluginInspection, inspection);
    await subject.get().handleApproveLocalPlugin(['network.fetch']); await subject.settle();
    assert.deepEqual(subject.calls.find(([command]) => command === 'plugins:install_inspected')[1], {
        inspectionId: inspection.inspectionId, packageDigest: inspection.packageDigest, optionalPermissionIds: ['network.fetch'],
    });
    assert.ok(subject.calls.some(([command, id]) => command === 'runtime' && id === plugin.manifest.id));
    assert.ok(subject.calls.some(([command]) => command === 'plugins:commit_activation'));
});

test('failed activation rolls back instead of committing the inspected package', async () => {
    const subject = harness({ runtime: false }); await subject.settle(); subject.calls.length = 0;
    await subject.get().handleInspectMarketplacePlugin(release); await subject.settle();
    await subject.get().handleApproveLocalPlugin([]); await subject.settle();
    assert.ok(subject.calls.some(([command]) => command === 'plugins:rollback_activation'));
    assert.equal(subject.calls.some(([command]) => command === 'plugins:commit_activation'), false);
    assert.equal(subject.get().needsRestart, true);
});

test('pending and late inspections are discarded when the surface unmounts', async () => {
    const ready = harness(); await ready.settle(); ready.calls.length = 0;
    await ready.get().handleInspectMarketplacePlugin(release); await ready.settle(); ready.unmount();
    assert.ok(ready.calls.some(([command]) => command === 'plugins:discard_inspection'));
    const late = harness(); await late.settle(); late.calls.length = 0;
    let resolve;
    late.deferInspection(new Promise(done => { resolve = done; }));
    const operation = late.get().handleInspectMarketplacePlugin(release); late.unmount(); resolve(inspection); await operation;
    assert.ok(late.calls.some(([command]) => command === 'plugins:discard_inspection'));
});

test('load failures are visible and refresh retries metadata without mutation', async () => {
    const subject = harness({ loadFails: true, registryFails: true }); await subject.settle();
    assert.ok(subject.get().pluginsError); assert.ok(subject.get().registryError);
    assert.equal(subject.get().isLoadingPlugins, false); assert.equal(subject.get().isLoadingRegistry, false);
    const count = subject.calls.length;
    subject.get().refreshPlugins(); subject.render(); await subject.settle();
    assert.ok(subject.calls.length > count);
    assert.equal(subject.calls.some(([command]) => /install|toggle|runtime/.test(command)), false);
});

test('shared theme picker uses enabled trusted built-ins without a Worker or Settings', () => {
    const bridge = loadSource('features/plugins/pluginCommandBridge.ts');
    const events = [];
    const { openBuiltinThemePicker } = loadSource('features/plugins/presentation/themePicker.ts', {
        '../pluginCommandBridge': bridge,
    }, { window: { dispatchEvent: event => events.push(event) }, CustomEvent: class {
        constructor(type, options) { this.type = type; this.detail = options.detail; }
    } });
    const rows = [
        { path: 'builtin://light', enabled: true, manifest: { id: 'com.zync.theme.light', name: 'Light Theme', type: 'theme' } },
        { path: 'builtin://disabled', enabled: false, manifest: { id: 'com.zync.theme.disabled', type: 'theme' } },
        { path: '/third-party', enabled: true, manifest: { id: 'com.zync.theme.untrusted', type: 'theme' } },
    ];
    openBuiltinThemePicker(rows);
    assert.equal(events.length, 1); assert.equal(events[0].type, 'zync:quick-pick');
    assert.deepEqual(plain(events[0].detail.items).map(item => item.id), ['system', 'dark', 'light']);
    assert.equal(events[0].detail.requestId, 'color-theme-select'); assert.equal(events[0].detail.pluginId, 'system');
});

test('sidebar and Settings adapt the same controller without opening Settings on mount', () => {
    const calls = [];
    const manager = { plugins: [plugin], selectedRegistry: [release], isLoadingPlugins: false, isLoadingRegistry: false,
        processingId: null, isApprovingLocalPlugin: false, needsRestart: false,
        refreshPlugins: () => calls.push(['refresh']), handleTogglePlugin: (...args) => calls.push(['toggle', ...args]),
        handleUninstallPlugin: (...args) => calls.push(['uninstall', ...args]), handleInspectMarketplacePlugin: row => calls.push(['inspect', row]),
    };
    const { PluginsSidebar } = loadSource('components/layout/sidebar/PluginsSidebar.tsx', {
        react: { useState: () => [null, () => {}] }, 'react/jsx-runtime': jsxRuntime,
        '../../../context/PluginContext': { usePlugins: () => ({ runtimeHealth: [], reloadPlugins() {}, retryPluginRuntime() {} }) },
        '../../../store/useAppStore': { useAppStore: selector => selector({ isSettingsOpen: false, openSettings: tab => calls.push(['settings', tab]) }) },
        '../../../features/plugins/presentation/usePluginManagement': { usePluginManagement: options => { calls.push(['management', options.enabled]); return manager; } },
        '../../../features/plugins/presentation/themePicker': { openBuiltinThemePicker: rows => calls.push(['themes', rows]) },
        '../../plugins/PluginsSidebarContent': { PluginsSidebarContent: () => null },
        '../../settings/tabs/plugins/PluginDetailsDialog': { PluginDetailsDialog: () => null },
        '../../settings/tabs/plugins/PluginsDeveloperTab': { PluginPermissionReview: () => null },
    });
    const view = PluginsSidebar().props.children[0];
    assert.deepEqual(calls, [['management', true]]);
    view.props.onToggle(plugin); view.props.onUninstall(plugin); view.props.onInspect(release); view.props.onChooseTheme();
    assert.deepEqual(calls.slice(1).map(([command]) => command), ['toggle', 'uninstall', 'inspect', 'themes']);
    assert.equal(calls[2][2], false, 'ordinary uninstall retains private data');
    view.props.onOpenSettings(); assert.deepEqual(calls.at(-1), ['settings', 'plugins']);

    const adaptations = [];
    const { useSettingsPlugins } = loadSource('components/settings/hooks/useSettingsPlugins.ts', {
        '../../../features/plugins/presentation/usePluginManagement': { usePluginManagement: options => { adaptations.push(options); return manager; } },
    });
    for (const activeTab of ['plugins', 'appearance', 'general']) assert.equal(useSettingsPlugins({ isOpen: true, activeTab }), manager);
    assert.deepEqual(adaptations.map(value => [value.enabled, value.appearanceOnly]), [[true, false], [true, true], [false, false]]);
});
