import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { CombinedTabBar } from '../src/components/layout/CombinedTabBar';
import { useAppStore } from '../src/store/useAppStore';
import { paneContentKey, singleFeaturePane, singlePluginPane, splitPane } from '../src/lib/paneLayout';
import { CONTENT_PRESENTATION_VERSION, type ContentPresentationScope } from '../src/features/workspace/domain/contentPresentation';
import '../src/index.css';
import './uiOverlays.browser.css';

// A separate fixture document owns this in-memory store. No store actions which
// persist, connect, create terminals, execute plugins, or dispose resources run.
const scopeId = 'tab-presentation-fixture';
const files = singleFeaturePane('files', 'files-pane', 'files-one');
const plugin = singlePluginPane('owner:panel', 'plugin-pane', 'plugin-one');
const filesContent = { kind: 'feature', featureId: 'files', instanceId: 'files-one' } as const;
const pluginContent = { kind: 'plugin', pluginId: 'owner:panel', instanceId: 'plugin-one' } as const;
const termKey = paneContentKey({ kind: 'term', termId: 'shell' }, 'shell');
const featureKey = paneContentKey(filesContent, 'files-pane');
const pluginKey = paneContentKey(pluginContent, 'plugin-pane');
const standalone = { 'files-one': files, 'plugin-one': plugin };
const joined = splitPane(files, 'files-pane', 'horizontal', pluginContent, 4, 'after', 'plugin-pane');
if (!joined.ok) throw new Error('Could not create fixture split');
const joinedLayout = joined.layout;
const fixtureRoot = document.querySelector<HTMLDivElement>('#root')!;
const root = createRoot(fixtureRoot);
const results = document.querySelector<HTMLPreElement>('#results')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
let selected = 0;
const closed: string[] = [];
const splitClosed: string[] = [];
const noop = () => {};
const activate = () => {
    selected++;
    document.querySelector<HTMLOutputElement>('#activations')!.textContent = String(selected);
};
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function showScope(scope?: ContentPresentationScope) {
    flushSync(() => useAppStore.setState({ contentPresentation: scope ? { [scopeId]: scope } : {} }));
}
function closeLabels() {
    return Array.from(fixtureRoot.querySelectorAll<HTMLButtonElement>('button[aria-label^="Close "]'), button => button.getAttribute('aria-label'));
}
function check(condition: unknown, label: string) {
    if (!condition) throw new Error(label);
    results.textContent += `\nPASS ${label}`;
}
function render() {
    flushSync(() => root.render(<TooltipProvider><CombinedTabBar
        connectionId={scopeId} tabId="fixture" activeView="files" activeTerminalId="shell"
        featureTabs={[{ id: 'files-one', featureId: 'files', instanceId: 'files-one' }]}
        activeFeatureTabId="files-one" pinnedFeatures={[]}
        pluginPanels={[{ id: 'owner:panel', title: 'Plugin A', allowMultiple: true }]}
        onTabSelect={activate} onPluginTabSelect={activate} onFeatureTabSelect={activate} onSplitSelect={activate}
        onPluginTabClose={id => closed.push(id)} onTerminalClose={id => closed.push(id)}
        onFeatureTabClose={id => closed.push(id)} onPaneGroupClose={owner => { closed.push(owner); splitClosed.push(owner); }}
        onNewTerminal={noop} onTogglePin={noop}
    /></TooltipProvider>));
}

/** Preview production chrome using fixture-owned records, never persistence or resource actions. */
function previewGroup() {
    flushSync(() => useAppStore.setState({ terminals: { [scopeId]: [{ id: 'shell', title: 'Shell A' }] },
        paneLayouts: { [scopeId]: { 'files-one': joinedLayout } }, activePaneGroupOwner: { [scopeId]: 'files-one' }, contentPresentation: {} }));
    render();
}

document.body.dataset.overlayGalleryTheme = 'dark';
document.querySelector<HTMLButtonElement>('#theme')!.onclick = () => {
    document.body.dataset.overlayGalleryTheme = document.body.dataset.overlayGalleryTheme === 'dark' ? 'light' : 'dark';
};
document.querySelector<HTMLButtonElement>('#preview')!.onclick = previewGroup;
previewGroup();
runButton.onclick = async () => {
    runButton.disabled = true;
    results.textContent = 'Running';
    selected = 0;
    document.querySelector<HTMLOutputElement>('#activations')!.textContent = '0';
    closed.length = 0;
    splitClosed.length = 0;
    try {
        flushSync(() => useAppStore.setState({ terminals: { [scopeId]: [{ id: 'shell', title: 'Shell A' }] },
            paneLayouts: { [scopeId]: standalone }, activePaneGroupOwner: { [scopeId]: null }, contentPresentation: {} }));
        render();
        await settle();
        const addButton = fixtureRoot.querySelector<HTMLButtonElement>('[aria-label="Open a tab"]')!;
        const addBounds = addButton.getBoundingClientRect();
        const addIcon = addButton.querySelector('svg')!;
        const addIconBounds = addIcon.getBoundingClientRect();
        check(addBounds.width === 28 && addBounds.height === 28
            && addIconBounds.width === 16 && addIconBounds.height === 16 && addIcon.getAttribute('stroke-width') === '2',
        'Pane add button shares the top add button geometry and normal-weight icon');
        check(addButton.type === 'button' && addButton.getAttribute('aria-haspopup') === 'dialog'
            && addButton.getAttribute('aria-expanded') === 'false' && !addButton.hasAttribute('title'),
        'Shared add trigger keeps native non-submit semantics and Zync tooltip ownership');
        check(getComputedStyle(addButton.parentElement!).backgroundColor === 'rgba(0, 0, 0, 0)'
            && getComputedStyle(addButton.parentElement!).borderTopWidth === '0px',
        'Pane add button has no extra boxed background or border');
        addButton.click();
        await settle();
        const menuFilter = fixtureRoot.querySelector<HTMLInputElement>('[aria-label="Filter tabs"]');
        check(addButton.getAttribute('aria-expanded') === 'true' && menuFilter === document.activeElement
            && addButton.classList.contains('bg-app-accent/20') && selected === 0,
        'Shared add button opens the existing menu without activating a tab');
        menuFilter!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();
        check(addButton.getAttribute('aria-expanded') === 'false' && document.activeElement === addButton
            && !fixtureRoot.querySelector('[aria-label="Filter tabs"]'),
        'Escape dismisses the pane menu and returns focus through the shared native ref');
        check(closeLabels().join('|') === 'Close Shell A|Close Files|Close Plugin A', 'Uncustomized chrome keeps the default mixed DOM order');
        const pluginClose = fixtureRoot.querySelector<HTMLButtonElement>('[aria-label="Close Plugin A"]')!;
        pluginClose.focus();
        const order = [pluginKey, featureKey, termKey];
        showScope({ version: CONTENT_PRESENTATION_VERSION, items: {}, order });
        await settle();
        check(closeLabels().join('|') === 'Close Plugin A|Close Files|Close Shell A', 'Saved mixed order changes actual DOM order');
        check(document.activeElement === pluginClose && pluginClose.isConnected, 'Reordering retains the same focused close control');
        for (const key of [termKey, featureKey, pluginKey]) {
            showScope({ version: CONTENT_PRESENTATION_VERSION, items: { [key]: { pinned: true } }, order });
            await settle();
            const expected = key === termKey ? 'Close Shell A' : key === featureKey ? 'Close Files' : 'Close Plugin A';
            check(closeLabels()[0] === expected && fixtureRoot.querySelectorAll('[title="Pinned content"]').length === 1,
                `Pinning ${expected.slice('Close '.length)} moves its chrome first and exposes a pin indicator`);
            check(document.activeElement === pluginClose && pluginClose.isConnected, 'Pin projection preserves focused control identity');
        }
        pluginClose.click();
        check(closed.length === 1 && closed[0] === pluginKey && selected === 0, 'Pinned plugin close remains explicit and isolated from selection');
        flushSync(() => useAppStore.setState({ paneLayouts: { [scopeId]: { 'files-one': { ...joined.layout, activePaneId: 'files-pane' } } } }));
        await settle();
        check(closeLabels().join('|') === 'Close pane group (2 panes): Files · Plugin A|Close Shell A', 'A split projects once at the rank of its pinned member');
        let groupTab = fixtureRoot.querySelector<HTMLElement>('[aria-label="Pane group, 2 visible panes: Files, Plugin A"]')!;
        check(groupTab?.querySelector('[data-pane-group-icon]') && groupTab.querySelector('[data-tab-label]')?.textContent === 'Files · Plugin A'
            && !groupTab.querySelector('[data-pane-group-count]'),
            'Two-pane labels use a middle dot without a redundant count badge');
        const iconFrame = groupTab.querySelector<HTMLElement>('[data-pane-group-icon]')!;
        const iconCells = Array.from(iconFrame.querySelectorAll<HTMLElement>('[data-pane-group-member]'));
        const cellBounds = iconCells.map(cell => cell.getBoundingClientRect());
        check(iconCells.length === 2 && cellBounds[0].right <= cellBounds[1].left,
            'Group member icons have separate cells and never cover one another');
        check(iconCells.every((cell, index) => {
            const icon = cell.querySelector('svg, img');
            if (!icon) return false;
            const bounds = icon.getBoundingClientRect();
            const cellBox = cellBounds[index];
            return bounds.width === 13 && bounds.height === 13
                && bounds.left >= cellBox.left && bounds.right <= cellBox.right
                && bounds.top >= cellBox.top && bounds.bottom <= cellBox.bottom;
        }), 'Group icons stay 13px and fully inside their shared frame');
        const groupRow = groupTab.querySelector<HTMLElement>('[data-pane-group-tab]')!;
        const rowBox = groupRow.getBoundingClientRect();
        const trigger = groupRow.querySelector<HTMLButtonElement>('[data-workspace-tab-trigger]')!;
        check(trigger.tagName === 'BUTTON' && trigger.getAttribute('aria-pressed') !== null
            && !trigger.querySelector('button'), 'Group selection is a named native button with a separate close control');
        const parts = [...Array.from(trigger.children), groupRow.querySelector('[data-pane-group-close]')!].map(element => element.getBoundingClientRect());
        check(rowBox.height === 28 && parts.every(bounds =>
            Math.abs((bounds.top + bounds.bottom) / 2 - (rowBox.top + rowBox.bottom) / 2) < 0.5),
        'Group icons, label, pin and close share one vertical center');
        check(parts.slice(1).every((bounds, index) => Math.abs(bounds.left - parts[index].right - 6) < 0.5),
            'Every group-tab item has the same 6px gap');
        const closeBox = groupRow.querySelector('[data-pane-group-close]')!.getBoundingClientRect();
        check(closeBox.width === 20 && closeBox.height === 20
            && closeBox.right < rowBox.right && parts[0].left > rowBox.left,
        'Group close control keeps a centered fixed-size slot and inset edges');
        check(groupTab.querySelector('[data-tab-drag-preview] [data-tab-label]')?.textContent === 'Files · Plugin A'
            && !groupTab.querySelector('[data-tab-drag-preview] [data-pane-group-count]'), 'Group drag preview shares the same simplified label');
        check(fixtureRoot.querySelectorAll('[title="Pinned content"]').length === 1, 'A split displays one content pin indicator');
        fixtureRoot.querySelector<HTMLButtonElement>('[aria-label="Close pane group (2 panes): Files · Plugin A"]')!.click();
        check(closed[1] === 'files-one', 'Pinned split close still targets its current canvas owner');
        showScope({ version: CONTENT_PRESENTATION_VERSION, items: { [featureKey]: { hidden: true }, [pluginKey]: { pinned: true } } });
        await settle();
        check(closeLabels().join('|') === 'Close pane group (2 panes, including 1 hidden): Plugin A|Close Shell A', 'A partially hidden split remains one visible tab');
        check(groupTab.isConnected && groupTab.getAttribute('aria-label') === 'Pane group, 1 visible pane: Plugin A (1 hidden)'
            && groupTab.querySelector('[data-tab-label]')?.textContent === 'Plugin A', 'Hiding a member updates the same tab without counting hidden panes');
        fixtureRoot.querySelector<HTMLButtonElement>('[aria-label="Close pane group (2 panes, including 1 hidden): Plugin A"]')!.click();
        check(splitClosed.at(-1) === 'files-one', 'Group close targets the canonical owner, including hidden members');
        showScope({ version: CONTENT_PRESENTATION_VERSION, items: { [featureKey]: { hidden: true }, [pluginKey]: { hidden: true }, [termKey]: { hidden: true } } });
        await settle();
        check(closeLabels().length === 0, 'All-hidden removes only content tab chrome');
        check(Object.keys(useAppStore.getState().paneLayouts[scopeId] ?? {}).length === 1
            && useAppStore.getState().terminals[scopeId].length === 1, 'Hidden tab projection retains canonical layouts and terminals');
        showScope({ version: CONTENT_PRESENTATION_VERSION, items: { [featureKey]: { hidden: true } } });
        await settle();
        check(closeLabels().join('|') === 'Close Shell A|Close pane group (2 panes, including 1 hidden): Plugin A', 'Revealing a split member brings back the same canvas tab');
        // All-hidden intentionally removes chrome, not resource hosts. Revealing recreates its tab.
        groupTab = fixtureRoot.querySelector<HTMLElement>('[aria-label="Pane group, 1 visible pane: Plugin A (1 hidden)"]')!;
        showScope({ version: CONTENT_PRESENTATION_VERSION, items: { [featureKey]: { displayAlias: 'Project files' } } });
        await settle();
        check(groupTab.isConnected && groupTab.getAttribute('aria-label') === 'Pane group, 2 visible panes: Project files, Plugin A'
            && groupTab.querySelector('[data-tab-label]')?.textContent === 'Project files · Plugin A', 'Member aliases and reveal update group chrome without replacing its identity');
        const three = splitPane(joined.layout, 'plugin-pane', 'vertical', { kind: 'term', termId: 'shell' }, 4, 'after', 'shell-pane');
        if (!three.ok) throw new Error('Could not create three-pane fixture');
        const four = splitPane(three.layout, 'shell-pane', 'horizontal', { kind: 'term', termId: 'shell-b' }, 4, 'after', 'shell-b-pane');
        if (!four.ok) throw new Error('Could not create four-pane fixture');
        for (const [count, layout] of [[3, three.layout], [4, four.layout]] as const) {
            flushSync(() => useAppStore.setState({ paneLayouts: { [scopeId]: { 'files-one': layout } },
                terminals: { [scopeId]: [{ id: 'shell', title: 'Shell A' }, { id: 'shell-b', title: 'Shell B' }] } }));
            await settle();
            check(groupTab.isConnected && groupTab.querySelector('[data-pane-group-close]')?.getAttribute('aria-label') === `Close pane group (${count} panes): Project files`
                && groupTab.querySelector('[data-tab-label]')?.textContent === `Project files · ${count} panes`
                && groupTab.querySelector('[data-tab-drag-preview] [data-tab-label]')?.textContent === `Project files · ${count} panes`,
                `${count}-pane groups and previews share one label with the first name and visible count`);
            check(groupTab.querySelector('[data-pane-group-icon]')!.children.length === 2,
                `${count}-pane groups keep icons compact rather than adding more controls`);
        }
        const longAlias = 'A very long project workspace name '.repeat(2).trim();
        showScope({ version: CONTENT_PRESENTATION_VERSION, items: { [featureKey]: { displayAlias: longAlias, pinned: true } } });
        await settle();
        const longRow = groupTab.querySelector<HTMLElement>('[data-pane-group-tab]')!;
        const longBounds = longRow.getBoundingClientRect();
        const longLabel = longRow.querySelector<HTMLElement>('[data-tab-label]')!;
        const longClose = longRow.querySelector('[data-pane-group-close]')!.getBoundingClientRect();
        check(longBounds.width <= 240 && longLabel.scrollWidth > longLabel.clientWidth
            && longClose.width === 20 && longClose.right < longBounds.right
            && longLabel.textContent === `${longAlias} · 4 panes`
            && groupTab.getAttribute('aria-label')?.includes(longAlias),
        'Long pinned labels truncate while icons and close stay inside the tab, with full names and count accessible');
        flushSync(() => useAppStore.setState({ terminals: { [scopeId]: [{ id: 'shell', title: 'Shell A' }] } }));
        flushSync(() => useAppStore.setState({ paneLayouts: { [scopeId]: standalone }, contentPresentation: {} }));
        await settle();
        check(closeLabels().join('|') === 'Close Shell A|Close Files|Close Plugin A', 'Reset recovers default tab order without changing live instances');
        results.textContent += '\nALL CHECKS PASSED';
    } catch (error) {
        results.textContent += `\nFAIL ${String(error)}`;
    } finally {
        runButton.disabled = false;
    }
};
