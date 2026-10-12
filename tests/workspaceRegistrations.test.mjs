import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    BUILTIN_WORKSPACE_VIEW_REGISTRATIONS,
    WORKSPACE_VIEW_LIMITS,
    buildWorkspaceViewRegistry,
    builtinWorkspaceViewId,
    parseWorkspaceViewRegistration,
    pluginWorkspaceViewId,
    resolveWorkspaceViewRegistration,
} from '../.tmp-agent-tests/src/features/workspace/domain/registrations.js';
import {
    buildWorkspaceViewRegistrations,
    registrationForContent,
} from '../.tmp-agent-tests/src/features/workspace/application/viewRegistrationAdapters.js';
import { SPLIT_FEATURE_IDS } from '../.tmp-agent-tests/src/lib/paneLayout/types.js';
import { PANE_REGIONS } from '../.tmp-agent-tests/src/lib/paneLayout/regions.js';

const terminal = () => ({
    id: 'builtin:terminal', source: { kind: 'terminal' }, label: 'Terminal',
    allowedLocations: ['workspace'], multiplicity: 'multiple', capabilities: ['rename', 'reorder', 'pin', 'hide'],
});
const plugin = (pluginId = 'zync.docker', panelId = 'zync.docker:manager') => ({
    ...terminal(), id: pluginWorkspaceViewId(pluginId, panelId),
    source: { kind: 'plugin', pluginId, panelId }, label: 'Docker Manager', multiplicity: 'single',
});

test('built-in metadata covers the canonical layout feature IDs without changing live pane identities', () => {
    const registry = buildWorkspaceViewRegistrations();
    assert.deepEqual(registry.issues, []);
    assert.deepEqual(registry.registrations.map(view => view.id), ['terminal', ...SPLIT_FEATURE_IDS].map(builtinWorkspaceViewId));
    for (const definition of BUILTIN_WORKSPACE_VIEW_REGISTRATIONS) {
        assert.equal(parseWorkspaceViewRegistration(definition).ok, true);
        assert.deepEqual(definition.allowedLocations, PANE_REGIONS);
        assert.equal(definition.multiplicity, 'multiple');
    }
    const content = { kind: 'feature', featureId: 'files', instanceId: 'listing-7' };
    assert.equal(registrationForContent(registry, content).id, builtinWorkspaceViewId('files'));
    assert.deepEqual(content, { kind: 'feature', featureId: 'files', instanceId: 'listing-7' });
    assert.equal(registrationForContent(registry, { kind: 'term', termId: 'shell-4' }).id, 'builtin:terminal');
});

test('plugin registration IDs retain complete opaque panel and owner identities without collisions', () => {
    const v2 = parseWorkspaceViewRegistration(plugin());
    assert.equal(v2.ok, true);
    assert.deepEqual(v2.registration.source, { kind: 'plugin', pluginId: 'zync.docker', panelId: 'zync.docker:manager' });
    assert.equal(v2.registration.id, 'plugin:zync.docker:zync.docker%3Amanager');
    const ids = [pluginWorkspaceViewId('owner:a', 'b'), pluginWorkspaceViewId('owner', 'a:b'),
        pluginWorkspaceViewId('owner', '%3A'), pluginWorkspaceViewId('owner', ':'),
        pluginWorkspaceViewId('other', 'a:b')];
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(parseWorkspaceViewRegistration(plugin('legacy-plugin', 'unprefixed-panel')).ok, true);
    assert.equal(parseWorkspaceViewRegistration({ ...plugin(), id: 'builtin:terminal' }).reason, 'id');
});

test('malformed identity and registration shapes fail validation without repairing identifiers', () => {
    for (const value of [undefined, null, [], false, 'terminal']) {
        assert.equal(parseWorkspaceViewRegistration(value).ok, false);
    }
    for (const value of ['', ' ', 'a b', 'a\nb', '\u202ehost', '\ud800', '\udc00', 'x'.repeat(WORKSPACE_VIEW_LIMITS.pluginIdLength + 1)]) {
        assert.equal(pluginWorkspaceViewId(value, 'panel'), undefined);
    }
    assert.equal(pluginWorkspaceViewId('owner', 'x'.repeat(WORKSPACE_VIEW_LIMITS.panelIdLength + 1)), undefined);
    const longestNativeId = 'p'.repeat(128) + ':' + 'k'.repeat(128);
    assert.equal(parseWorkspaceViewRegistration(plugin('p'.repeat(128), longestNativeId)).ok, true);
    for (const source of [{}, { kind: 'feature', featureId: 'unknown' }, { kind: 'plugin', panelId: 'legacy' }]) {
        assert.equal(parseWorkspaceViewRegistration({ ...terminal(), source }).reason, 'source');
    }
    assert.equal(parseWorkspaceViewRegistration({ ...terminal(), id: ' builtin:terminal' }).reason, 'id');
});

test('labels accept bounded Unicode text while capabilities and locations use closed supported sets', () => {
    const normalized = parseWorkspaceViewRegistration({ ...terminal(), label: '  Cafe\u0301  工作  ' });
    assert.equal(normalized.registration.label, 'Café 工作');
    assert.equal(parseWorkspaceViewRegistration({ ...terminal(), label: '😀'.repeat(120) }).ok, true);
    for (const label of ['', ' ', '😀'.repeat(121), 'Hidden\u202e', 'new\nline', '\ud800']) {
        assert.equal(parseWorkspaceViewRegistration({ ...terminal(), label }).reason, 'label');
    }
    for (const allowedLocations of [undefined, [], ['sidebar'], ['workspace', 'workspace'], 'workspace']) {
        assert.equal(parseWorkspaceViewRegistration({ ...terminal(), allowedLocations }).reason, 'locations');
    }
    for (const capabilities of [undefined, ['execute'], ['hide', 'hide'], ['rename', 'reorder', 'pin', 'hide', 'extra'], Array(1), 'hide']) {
        assert.equal(parseWorkspaceViewRegistration({ ...terminal(), capabilities }).reason, 'capabilities');
    }
    assert.equal(parseWorkspaceViewRegistration({ ...terminal(), capabilities: [] }).ok, true);
    for (const multiplicity of [undefined, true, 2, 'singleton']) {
        assert.equal(parseWorkspaceViewRegistration({ ...terminal(), multiplicity }).reason, 'multiplicity');
    }
});

test('a registry keeps the first valid duplicate and isolates snapshots from input mutation', () => {
    const valid = terminal();
    const registry = buildWorkspaceViewRegistry([{ ...valid, label: '' }, valid, { ...valid, label: 'Replacement' }, plugin()]);
    assert.deepEqual(registry.issues, [{ index: 0, reason: 'label' }, { index: 2, reason: 'duplicate' }]);
    assert.deepEqual(registry.registrations.map(view => view.label), ['Terminal', 'Docker Manager']);
    valid.label = 'Changed';
    valid.source.kind = 'changed';
    valid.allowedLocations[0] = 'elsewhere';
    valid.capabilities.length = 0;
    const registered = registry.registrations[0];
    assert.equal(registered.label, 'Terminal');
    assert.equal(registered.source.kind, 'terminal');
    assert.deepEqual(registered.allowedLocations, ['workspace']);
    assert.equal(registered.capabilities.length, 4);
    const extraFields = parseWorkspaceViewRegistration({ ...terminal(), html: '<script>ignored</script>', render: () => {} });
    assert.equal('html' in extraFields.registration, false);
    assert.equal('render' in extraFields.registration, false);
});

test('registry input is bounded and missing lookups never fall through to another view', () => {
    for (const value of [null, {}, 'bad']) assert.deepEqual(buildWorkspaceViewRegistry(value).issues, [{ index: null, reason: 'not-array' }]);
    const input = Array.from({ length: WORKSPACE_VIEW_LIMITS.registrations + 1 }, (_, index) => plugin('owner', `panel-${index}`));
    const registry = buildWorkspaceViewRegistry(input);
    assert.equal(registry.registrations.length, WORKSPACE_VIEW_LIMITS.registrations);
    assert.deepEqual(registry.issues, [{ index: WORKSPACE_VIEW_LIMITS.registrations, reason: 'limit' }]);
    const removed = pluginWorkspaceViewId('removed-owner', 'panel-0');
    assert.deepEqual(resolveWorkspaceViewRegistration(registry, removed), { status: 'missing', id: removed });
    assert.deepEqual(resolveWorkspaceViewRegistration(registry, '__proto__'), { status: 'missing', id: '__proto__' });
    const first = registry.registrations[0];
    assert.equal(resolveWorkspaceViewRegistration(registry, first.id).registration, first);
});

test('composition retains installed definitions during reload with explicit owners and native multiplicity defaults', () => {
    const installed = [{ manifest: { id: 'owner', contributes: { paneKinds: [
        { id: 'one', title: 'Installed one' }, { id: 'many', title: 'Installed many', allowMultiple: true },
    ] } } }];
    const registry = buildWorkspaceViewRegistrations([
        { id: 'owner:one', pluginId: 'owner', title: 'Live one', allowMultiple: true },
        { id: 'legacy-panel', pluginId: 'legacy-owner', title: 'Legacy' },
    ], installed);
    assert.deepEqual(registry.issues, []);
    const lookup = id => registrationForContent(registry, { kind: 'plugin', pluginId: id, instanceId: 'instance-4' });
    assert.equal(lookup('owner:one').label, 'Live one');
    assert.equal(lookup('owner:one').multiplicity, 'multiple');
    assert.equal(lookup('owner:many').multiplicity, 'multiple');
    assert.equal(lookup('legacy-panel').multiplicity, 'single');
    assert.equal(lookup('legacy-panel').source.pluginId, 'legacy-owner');
    const restarted = buildWorkspaceViewRegistrations([], installed);
    assert.equal(registrationForContent(restarted, { kind: 'plugin', pluginId: 'owner:one' }).multiplicity, 'single');
});

test('missing, malformed and ambiguous plugin ownership stays unresolved without changing surviving views', () => {
    const registry = buildWorkspaceViewRegistrations([{ id: 'owner:panel', title: 'Owner not proven' }]);
    assert.deepEqual(registry.issues, [{ index: BUILTIN_WORKSPACE_VIEW_REGISTRATIONS.length, reason: 'source' }]);
    assert.equal(registrationForContent(registry, { kind: 'plugin', pluginId: 'owner:panel' }), undefined);
    assert.equal(registrationForContent(registry, { kind: 'term', termId: 'term-1' }).label, 'Terminal');
    const ambiguous = buildWorkspaceViewRegistry([plugin('owner-a', 'legacy-panel'), plugin('owner-b', 'legacy-panel')]);
    assert.equal(ambiguous.registrations.length, 2);
    assert.equal(registrationForContent(ambiguous, { kind: 'plugin', pluginId: 'legacy-panel' }), undefined);
    assert.equal(registrationForContent(ambiguous, { kind: 'plugin', pluginId: 'missing-panel' }), undefined);
});
