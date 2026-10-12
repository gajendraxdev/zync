import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorkspaceDocking, planWorkspaceDockMove, workspaceDockingCapacity } from '../.tmp-agent-tests/src/features/workspace/domain/docking.js';
import { paneContentKey } from '../.tmp-agent-tests/src/lib/paneLayout/contentIdentity.js';
import { PANE_REGIONS } from '../.tmp-agent-tests/src/lib/paneLayout/regions.js';
import { describeDockedTab } from '../.tmp-agent-tests/src/features/workspace/domain/dockPresentation.js';

const leaf = id => ({ type: 'pane', id, content: { kind: 'term', termId: id } });
const key = id => paneContentKey(leaf(id).content, id);
const single = id => ({ version: 1, activePaneId: id, root: leaf(id) });
const pair = (id, first, second) => ({ type: 'split', id, direction: 'horizontal', sizes: [0.5, 0.5], children: [first, second] });
const group = (...ids) => ({ version: 1, activePaneId: ids[0], root: ids.slice(1).reduce((root, id) => pair(`split-${id}`, root, leaf(id)), leaf(ids[0])) });
const valid = () => ({ local: { version: 1, placements: { [key('shell')]: 'bottom-panel' }, sizes: { primary: 0.24, secondary: 0.24, bottom: 0.32 } } });

test('dock presentation describes only addressed visible members and separates dock focus from center selection', () => {
    const placements = { [key('a')]: 'secondary-sidebar', [key('b')]: 'bottom-panel', [key('dormant')]: 'primary-sidebar' };
    const before = JSON.stringify(placements);
    assert.equal(describeDockedTab([], placements, key('a')), undefined);
    assert.equal(describeDockedTab([key('center')], placements), undefined);
    const single = describeDockedTab([key('a')], placements, key('a'));
    assert.equal(single.label, 'Docked right'); assert.equal(single.focused, true);
    assert.match(single.description, /stay visible across tabs.*Click to focus/);
    assert.deepEqual(single.regions, ['secondary-sidebar']);
    const grouped = describeDockedTab([key('b'), key('a')], placements, key('b'));
    assert.equal(grouped.label, 'Docked right / bottom'); assert.equal(grouped.focused, true);
    const mixed = describeDockedTab([key('center'), key('a')], placements, key('a'));
    assert.equal(mixed.label, 'Includes panes docked right'); assert.equal(mixed.focused, false);
    assert.doesNotMatch(mixed.description, /Click to focus/);
    assert.equal(describeDockedTab([key('a')], placements, key('center')).focused, false);
    assert.equal(JSON.stringify(placements), before);
});

test('docking defaults are empty; accepted envelopes copy values without binding dormant resources', () => {
    assert.deepEqual(parseWorkspaceDocking(undefined), { ok: true, value: {} });
    const input = valid(); const parsed = parseWorkspaceDocking(input);
    assert.ok(parsed.ok); assert.deepEqual(parsed.value, input);
    input.local.placements[key('shell')] = 'primary-sidebar'; input.local.sizes.bottom = 0.5;
    assert.equal(parsed.value.local.placements[key('shell')], 'bottom-panel');
    assert.equal(parsed.value.local.sizes.bottom, 0.32);
});

test('docking schemas fail closed for unknown, partial, malformed and oversized fields', () => {
    for (const bad of [null, [], { local: null }, { local: { version: 2, placements: {} } },
        { local: { ...valid().local, extra: true } }, { local: { version: 1 } },
        { local: { version: 1, placements: { [key('shell')]: 'workspace' } } },
        { local: { version: 1, placements: { [key('shell')]: ['bottom-panel'] } } },
        { local: { version: 1, placements: { invalid: 'bottom-panel' } } },
        { local: { ...valid().local, sizes: { primary: 0.24 } } },
        { local: { ...valid().local, sizes: { primary: 0.24, secondary: 0.24, bottom: 0.6 } } },
        { local: { ...valid().local, sizes: null } },
        { local: { ...valid().local, sizes: { primary: NaN, secondary: 0.24, bottom: 0.32 } } },
        { ' ': valid().local }, { ['a'.repeat(257)]: valid().local },
        Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`scope-${index}`, valid().local])),
        { local: { version: 1, placements: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [key(`term-${index}`), 'bottom-panel'])) } },
    ]) assert.equal(parseWorkspaceDocking(bad).ok, false, JSON.stringify(bad));
});

test('size bounds and canonical Unicode identities match the documented envelope', () => {
    for (const sizes of [{ primary: 0.15, secondary: 0.15, bottom: 0.2 }, { primary: 0.35, secondary: 0.35, bottom: 0.5 }]) {
        assert.ok(parseWorkspaceDocking({ local: { version: 1, placements: { [key('日本語 😄')]: 'primary-sidebar' }, sizes } }).ok);
    }
    assert.deepEqual(parseWorkspaceDocking({ local: { version: 1, placements: {} } }), { ok: true, value: {} });
});

test('docked panes reserve capacity against all canvases, without counting dormant assignments', () => {
    const canvases = [group('a', 'b'), group('c', 'd', 'e')];
    const placements = new Map([[key('a'), 'bottom-panel'], [key('not-live'), 'primary-sidebar']]);
    assert.deepEqual(workspaceDockingCapacity(canvases, placements), { ok: true, dockedCount: 1, availableMainPanes: 3 });
    const overflow = workspaceDockingCapacity([...canvases, group('f', 'g', 'h', 'i')], placements);
    assert.deepEqual(overflow, { ok: false, reason: 'capacity' });
});

test('moves are atomic across connections/canvases and refuse overflow before changing assignments', () => {
    const canvases = [single('dock'), group('a', 'b', 'c', 'd')]; const previous = new Map();
    const before = JSON.stringify(canvases);
    assert.deepEqual(planWorkspaceDockMove(canvases, previous, key('dock'), 'bottom-panel', PANE_REGIONS), { ok: false, reason: 'capacity' });
    assert.equal(previous.size, 0); assert.equal(JSON.stringify(canvases), before);
    assert.equal(planWorkspaceDockMove(canvases, previous, key('another-connection'), 'bottom-panel', PANE_REGIONS).reason, 'missing-content');
    assert.equal(planWorkspaceDockMove(canvases, previous, key('dock'), 'bottom-panel', ['workspace']).reason, 'unsupported-location');
});

test('moves within a full canvas keep its canonical budget and can return to the center', () => {
    const canvases = [group('a', 'b', 'c', 'd')];
    const moved = planWorkspaceDockMove(canvases, new Map(), key('a'), 'primary-sidebar', PANE_REGIONS);
    assert.ok(moved.ok);
    const same = planWorkspaceDockMove(canvases, moved.assignments, key('a'), 'primary-sidebar', PANE_REGIONS);
    assert.equal(same.assignments, moved.assignments);
    const restored = planWorkspaceDockMove(canvases, moved.assignments, key('a'), 'workspace', PANE_REGIONS);
    assert.ok(restored.ok); assert.equal(restored.assignments.size, 0);
});

test('duplicate ownership and over-cap source layouts cannot be hidden by the region model', () => {
    assert.equal(workspaceDockingCapacity([single('a'), single('a')], new Map()).reason, 'duplicate-content');
    assert.equal(planWorkspaceDockMove([group('a', 'b', 'c', 'd', 'e')], new Map(), key('a'), 'bottom-panel', PANE_REGIONS).reason, 'invalid-layout');
    const allDocked = new Map(['a', 'b', 'c', 'd'].map(id => [key(id), 'bottom-panel']));
    assert.equal(workspaceDockingCapacity([group('a', 'b', 'c', 'd')], allDocked).availableMainPanes, 0);
    assert.equal(workspaceDockingCapacity([group('a', 'b', 'c', 'd'), single('e')], allDocked).reason, 'capacity');
});
