import { useEffect } from 'react';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useRetainedItems } from '../src/components/layout/useRetainedItems';
import { retainedItemsInMountOrder } from '../src/components/layout/retainedItems';
import { changeMainTabPresentation, reorderMainTabsById } from '../src/features/workspace/domain/mainTabPresentation';
import type { Tab } from '../src/features/connections/domain/types';
import { WorkspaceTabList } from '../src/components/layout/WorkspaceTabList';
import { dragTab } from './helpers/tabDrag.browser';
import '../src/index.css';

type FixtureTab = Tab;
const root = createRoot(document.querySelector('#root')!);
const results = document.querySelector('#results')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
import.meta.hot?.dispose(() => root.unmount());
const mounts = new Map<string, number>();
const disposals = new Map<string, number>();
const loads = new Map<string, number>();
const tabs: FixtureTab[] = [
    { id: 'one', title: 'First workspace', type: 'connection', view: 'terminal' },
    { id: 'two', title: 'Second workspace', type: 'connection', view: 'terminal' },
    { id: 'lazy', title: 'Unvisited workspace', type: 'connection', view: 'terminal' },
];

function Probe({ tab, active }: { tab: FixtureTab; active: boolean }) {
    useEffect(() => {
        mounts.set(tab.id, (mounts.get(tab.id) ?? 0) + 1);
        return () => { disposals.set(tab.id, (disposals.get(tab.id) ?? 0) + 1); };
    }, [tab.id]);
    return <section data-workspace-host={tab.id} style={{ display: active ? 'block' : 'none' }}>
        <h2>{tab.title}</h2>
        <div><iframe title={tab.title} srcDoc='<input aria-label="Saved state" value="initial">'
            onLoad={() => loads.set(tab.id, (loads.get(tab.id) ?? 0) + 1)} /></div>
    </section>;
}

/** The production hook and projection must keep iframe ancestors in their original slots. */
function Scenario({ items, active }: { items: FixtureTab[]; active: string | null }) {
    const retained = useRetainedItems(items.map(tab => tab.id), active);
    return <TooltipProvider><div>
        <WorkspaceTabList tabs={items} activeTabId={active} className="flex items-center gap-1.5 overflow-x-auto py-3"
            onReorder={(source, target) => { void render(reorderMainTabsById(items, source, target), active); }}
            onActivate={() => { throw new Error('Drag must not activate'); }} onClose={() => { throw new Error('Drag must not close'); }}
            onDisconnect={() => { throw new Error('Drag must not disconnect'); }} onRename={() => {}}
            canDisconnect={() => false} renderIcon={() => <span>▣</span>} />
        {retainedItemsInMountOrder(items, retained).map(tab => <Probe key={tab.id} tab={tab} active={tab.id === active} />)}
    </div></TooltipProvider>;
}

const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const frameFor = (id: string) => document.querySelector<HTMLIFrameElement>(`[data-workspace-host="${id}"] iframe`);
const hostOrder = () => [...document.querySelectorAll<HTMLElement>('[data-workspace-host]')].map(host => host.dataset.workspaceHost).join(',');
function check(condition: unknown, label: string) {
    if (!condition) throw new Error(label);
    results.textContent += `\nPASS ${label}`;
}
async function render(items: FixtureTab[], active: string | null) {
    flushSync(() => root.render(<Scenario items={items} active={active} />));
    await settle();
}
async function readyFrame(id: string): Promise<HTMLIFrameElement> {
    const iframe = frameFor(id);
    if (!iframe) throw new Error(`Missing frame ${id}`);
    if (!iframe.contentDocument?.querySelector('input')) {
        await new Promise<void>((resolve, reject) => {
            const finish = () => {
                clearTimeout(timer);
                iframe.removeEventListener('load', finish);
                resolve();
            };
            const timer = setTimeout(() => {
                iframe.removeEventListener('load', finish);
                reject(new Error(`Frame ${id} did not load`));
            }, 3000);
            iframe.addEventListener('load', finish);
        });
    }
    return iframe;
}

runButton.onclick = async () => {
    runButton.disabled = true;
    results.textContent = 'Running';
    try {
        flushSync(() => root.render(null));
        mounts.clear();
        disposals.clear();
        loads.clear();
        await render(tabs, 'one');
        const firstFrame = await readyFrame('one');
        check(!frameFor('two') && !frameFor('lazy'), 'Unvisited tabs do not mount');
        await render(tabs, 'two');
        const secondFrame = await readyFrame('two');
        const records = [firstFrame, secondFrame].map(frame => ({
            frame, document: frame.contentDocument!, window: frame.contentWindow!,
            input: frame.contentDocument!.querySelector('input')!,
        }));
        records.forEach((record, index) => { record.input.value = `preserved-${index}`; });
        const assertSurvival = (label: string) => {
            records.forEach((record, index) => {
                check(record.frame.isConnected && frameFor(index === 0 ? 'one' : 'two') === record.frame
                    && record.frame.contentDocument === record.document && record.frame.contentWindow === record.window
                    && record.document.querySelector('input') === record.input && record.input.value === `preserved-${index}`,
                `${label}: workspace ${index + 1} retains its frame, document and state`);
            });
        };

        const slot = (id: string) => document.querySelector<HTMLElement>(`[data-workspace-tab-item="${id}"]`)!;
        await dragTab(slot('one'), slot('lazy'));
        check([...document.querySelectorAll<HTMLElement>('[data-workspace-tab-item]')].map(node => node.dataset.workspaceTabItem).join(',') === 'two,lazy,one',
            'Production pointer drag reorders chrome through the stable-ID adapter');
        check(hostOrder() === 'one,two', 'Reordering tabs leaves mounted host order unchanged');
        assertSurvival('Reorder');
        const decoration = changeMainTabPresentation(undefined, { type: 'set-icon', icon: 'star' });
        if (!decoration.ok) throw new Error('Fixture icon action refused');
        const accented = changeMainTabPresentation(decoration.value, { type: 'set-accent', accent: '#123456' });
        if (!accented.ok) throw new Error('Fixture accent action refused');
        const closeDisplay = changeMainTabPresentation(accented.value, { type: 'set-close-button', closeButton: 'hidden' });
        if (!closeDisplay.ok) throw new Error('Fixture close preference refused');
        await render(tabs.map(tab => ({ ...tab, presentation: closeDisplay.value })), 'two');
        assertSurvival('Icon, accent and close-display edits');
        check(hostOrder() === 'one,two' && !frameFor('lazy'), 'Decorations do not mount unvisited workspaces or move retained hosts');
        const added: FixtureTab = { id: 'new', title: 'Inserted workspace', type: 'connection', view: 'terminal' };
        const inserted = [added, tabs[1], tabs[2], tabs[0]];
        await render(inserted, 'two');
        check(!frameFor('new'), 'Adding an inactive tab does not mount it');
        assertSurvival('Insert');
        await render(inserted, 'new');
        const addedFrame = await readyFrame('new');
        check(hostOrder() === 'one,two,new', 'First activation appends the host despite its first tab position');
        assertSurvival('First activation');
        await render(inserted, 'one');
        check(firstFrame.getBoundingClientRect().width > 0 && secondFrame.getBoundingClientRect().width === 0,
            'Activation changes visibility while retaining hidden frames');
        assertSurvival('Reactivate');

        await render([tabs[0], tabs[1], tabs[2]], 'two');
        check(!addedFrame.isConnected && disposals.get('new') === 1, 'Closing a sibling disposes only that host');
        assertSurvival('Remove sibling');
        await render([tabs[1], tabs[2]], 'two');
        check(!firstFrame.isConnected && disposals.get('one') === 1, 'Closing a visited tab disposes it exactly once');
        check(frameFor('two') === secondFrame && secondFrame.contentDocument === records[1].document,
            'Closing an earlier host preserves the survivor document');
        await render([tabs[0], tabs[1], tabs[2]], 'two');
        check(!frameFor('one'), 'Reopened inactive tabs stay lazy');
        await render([tabs[0], tabs[1], tabs[2]], 'one');
        const reopenedFrame = await readyFrame('one');
        check(reopenedFrame !== firstFrame && reopenedFrame.contentDocument?.querySelector('input')?.value === 'initial',
            'Reactivating a closed tab creates fresh content');
        check(hostOrder() === 'two,one' && frameFor('two') === secondFrame
            && secondFrame.contentDocument === records[1].document && records[1].input.value === 'preserved-1',
            'Reopened content appends without moving the surviving host');
        check(loads.get('two') === 1 && mounts.get('two') === 1 && mounts.get('one') === 2,
            'Reorder, insertion and activation never reload or remount surviving content');
        check(!frameFor('lazy'), 'Unvisited content stays lazy throughout');
        await render([], null);
        check(!secondFrame.isConnected && !reopenedFrame.isConnected && disposals.get('two') === 1 && disposals.get('one') === 2,
            'Closing all tabs disposes the remaining hosts');
        results.textContent += '\nALL CHECKS PASSED';
    } catch (error) {
        results.textContent += `\nFAIL ${String(error)}`;
    } finally {
        runButton.disabled = false;
    }
};
