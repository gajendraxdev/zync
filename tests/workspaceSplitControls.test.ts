import { createWorkspaceSplitControlsSelector, workspaceSplitTarget, type WorkspaceCanvasSelection,
    type WorkspaceDockingState } from '../src/features/workspace/domain/dockingView';
import { allowsAdditionalPaneBeside } from '../src/features/workspace/domain/dockingTopology';
import { singlePane, isSplitLayout, isTermContent, paneContentKey, type PaneLayout } from '../src/lib/paneLayout';

function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}

function fixture(): WorkspaceDockingState {
    const files: PaneLayout = { version: 1, activePaneId: 'files-pane', root: { type: 'pane', id: 'files-pane',
        content: { kind: 'feature', featureId: 'files', instanceId: 'files-one' } } };
    const plugin: PaneLayout = { version: 1, activePaneId: 'plugin-pane', root: { type: 'pane', id: 'plugin-pane',
        content: { kind: 'plugin', pluginId: 'demo', instanceId: 'plugin-one' } } };
    return { terminals: { local: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] },
        paneLayouts: { local: { a: singlePane('a', 'a'), b: singlePane('b', 'b'), files, plugin } },
        activeTerminalIds: { local: 'a' }, activePaneGroupOwner: { local: 'a' },
        workspaceDocking: {}, workspaceDockFocus: {}, contentPresentation: {}, maximizedWorkspacePanes: {} };
}

function fresh(state: WorkspaceDockingState, selection: WorkspaceCanvasSelection = {}) {
    const target = workspaceSplitTarget(state, 'local', selection);
    return { isSplit: isSplitLayout(target?.layout),
        canSplit: Boolean(target && allowsAdditionalPaneBeside(state, 'local',
            { contentId: paneContentKey(target.leaf.content, target.leaf.id) })),
        terminalId: target && isTermContent(target.leaf.content) ? target.leaf.content.termId : null };
}

// The expensive inventory must not even be traversed by unrelated store ticks.
const state = fixture();
let visits = 0;
const layout = state.paneLayouts.local!.a;
const root = layout.root;
Object.defineProperty(layout, 'root', { get: () => { visits++; return root; } });
const select = createWorkspaceSplitControlsSelector('local');
const first = select(state);
const initialVisits = visits;
check(initialVisits > 0 && first.terminalId === 'a' && first.canSplit, 'initial toolbar projection');
for (let transferred = 0; transferred < 1000; transferred++) {
    const tick = { ...state, transfers: [{ transferred }],
        terminals: { ...state.terminals, other: [{ id: 'other', title: 'Other' }] },
        paneLayouts: { ...state.paneLayouts, other: {} },
        activeTerminalIds: { ...state.activeTerminalIds, other: 'other' },
        activePaneGroupOwner: { ...state.activePaneGroupOwner, other: 'other' },
        contentPresentation: { ...state.contentPresentation, other: { version: 3 as const, items: {} } },
        workspaceDockFocus: { ...state.workspaceDockFocus, other: 'other' },
        maximizedWorkspacePanes: { ...state.maximizedWorkspacePanes, other: undefined } };
    check(select(tick) === first, 'progress and unrelated scope updates reuse the same projection');
}
check(visits === initialVisits, '1000 progress updates do not walk layout resources');

const keyA = paneContentKey({ kind: 'term', termId: 'a' }, 'a');
const keyB = paneContentKey({ kind: 'term', termId: 'b' }, 'b');
const mutations: Array<[string, (state: WorkspaceDockingState) => WorkspaceDockingState]> = [
    ['terminals', s => ({ ...s, terminals: { ...s.terminals, local: [...s.terminals.local] } })],
    ['layouts', s => ({ ...s, paneLayouts: { ...s.paneLayouts, local: { ...s.paneLayouts.local } } })],
    ['active terminal', s => ({ ...s, activeTerminalIds: { local: 'b' } })],
    ['active owner', s => ({ ...s, activePaneGroupOwner: { local: 'b' } })],
    ['visibility', s => ({ ...s, contentPresentation: { local: { version: 3, items: { [keyA]: { hidden: true } } } } })],
    ['docking', s => ({ ...s, workspaceDocking: { local: { version: 1, placements: { [keyB]: 'bottom-panel' } } } })],
    ['dock focus', s => ({ ...s, workspaceDockFocus: { local: keyB } })],
    ['maximize', s => ({ ...s, maximizedWorkspacePanes: { local: { contentId: keyA, selectedOwner: 'a' } } })],
    ['unknown format in another scope', s => ({ ...s, workspaceDocking: { other: { version: 99, placements: {} } } })],
];
for (const [name, mutate] of mutations) {
    const before = fixture();
    const selector = createWorkspaceSplitControlsSelector('local');
    const initial = selector(before);
    const after = mutate(before);
    const changed = selector(after);
    check(changed !== initial, `${name} invalidates the cached inputs`);
    check(JSON.stringify(changed) === JSON.stringify(fresh(after)), `${name} agrees with fresh policy`);
    check(selector(after) === changed, `${name} settles to one cached result`);
    check(selector(before) !== initial, `${name} keeps one entry, not snapshot history`);
}

for (const selection of [{}, { featureInstanceId: 'files-one', featureId: 'files' as const },
    { pluginPanelId: 'demo' }]) {
    const subject = fixture();
    const selector = createWorkspaceSplitControlsSelector('local', selection);
    check(JSON.stringify(selector(subject)) === JSON.stringify(fresh(subject, selection)), 'shell/feature/plugin selection uses shared targeting');
}
const docked = fixture();
docked.workspaceDocking = { local: { version: 1, placements: { [keyB]: 'bottom-panel' } } };
docked.workspaceDockFocus = { local: keyB };
const dockSelector = createWorkspaceSplitControlsSelector('local');
check(dockSelector(docked).terminalId === 'b', 'Find follows the visible dock, not the remembered center');
const hiddenDock = { ...docked, contentPresentation: { local: { version: 3 as const, items: { [keyB]: { hidden: true as const } } } } };
check(JSON.stringify(dockSelector(hiddenDock)) === JSON.stringify(fresh(hiddenDock)), 'hiding a focused dock immediately revalidates targeting');

const capped = fixture();
const leaves = ['a', 'b', 'c', 'd'].map(id => singlePane(id, id).root);
capped.paneLayouts = { local: { a: { version: 1, activePaneId: 'a', root: { type: 'split', id: 'all',
    direction: 'horizontal', sizes: [0.5, 0.5], children: [
        { type: 'split', id: 'left', direction: 'vertical', sizes: [0.5, 0.5], children: [leaves[0], leaves[1]] },
        { type: 'split', id: 'right', direction: 'vertical', sizes: [0.5, 0.5], children: [leaves[2], leaves[3]] },
    ] } } } };
capped.terminals.local = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id }));
const cappedControls = createWorkspaceSplitControlsSelector('local')(capped);
check(cappedControls.isSplit && !cappedControls.canSplit, 'the existing four-pane capacity still disables Split');
const isolated = createWorkspaceSplitControlsSelector('missing')(fixture());
check(!isolated.canSplit && !isolated.isSplit && isolated.terminalId === null, 'a missing scope cannot acquire another scope target');

console.log('Workspace split controls: progress reuse, eight layout invalidations, malformed metadata, visibility, dock focus, selection and capacity passed.');
