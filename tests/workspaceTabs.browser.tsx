import { useEffect, useRef, useState } from 'react';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Tab } from '../src/features/connections/domain/types';
import { normalizeDisplayAlias } from '../src/features/workspace/domain/presentation';
import { changeMainTabPresentation, reorderMainTabsById, stablePinnedMainTabs, type MainTabPresentationAction } from '../src/features/workspace/domain/mainTabPresentation';
import { listenWorkspacePresentationActions, WORKSPACE_PRESENTATION_EVENT } from '../src/features/shortcuts/workspacePresentation';
import { WorkspaceTabList } from '../src/components/layout/WorkspaceTabList';
import { useWorkspaceTabCloseFocus, type WorkspaceTabCloseFocusIntent } from '../src/components/layout/useWorkspaceTabCloseFocus';
import { WorkspaceTabAppearanceDialog } from '../src/components/layout/WorkspaceTabAppearanceDialog';
import { DisplayAliasDialog } from '../src/components/workspace/DisplayAliasDialog';
import { WorkspaceTabsSection } from '../src/components/settings/tabs/layout/WorkspaceTabsSection';
import type { MainTabCloseButtonMode } from '../src/features/workspace/domain/mainTabPresentation';
import { Button } from '../src/components/ui/Button';
import { ConfirmModal } from '../src/components/ui/ConfirmModal';
import { popupIsUnclipped } from './helpers/popupVisibility.browser';
import { dragTab, dragTabAtEdge } from './helpers/tabDrag.browser';
import '../src/index.css';
import './uiOverlays.browser.css';

const root = createRoot(document.querySelector('#root')!);
const result = document.querySelector('#results')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
let runId = 0;
function Fixture({ narrow = false, compactTitles = false }: { narrow?: boolean; compactTitles?: boolean }) {
    const [tabs, setTabs] = useState<Tab[]>([
        { id: 'host', type: 'connection', title: 'Production server', connectionId: 'server', view: 'terminal' },
        { id: 'local', type: 'connection', title: 'Local Terminal', displayAlias: 'My local shell', connectionId: 'local', view: 'terminal' },
        { id: 'public', type: 'public-urls', title: 'Public URLs', displayAlias: 'Preview links', view: 'terminal' },
    ].map(tab => compactTitles ? { ...tab, displayAlias: tab.id === 'host' ? 'A' : tab.id === 'local' ? 'B' : 'C' } : tab) as Tab[]);
    const [active, setActive] = useState<string | null>('host');
    const [editorKind, setEditorKind] = useState<'rename' | 'appearance'>('rename');
    const [menuError, setMenuError] = useState(false);
    const [closeButtonMode, setCloseButtonMode] = useState<MainTabCloseButtonMode>('hover');
    const [target, setTarget] = useState<string | null>(null);
    const [activations, setActivations] = useState(0);
    const [closes, setCloses] = useState(0);
    const [disconnects, setDisconnects] = useState(0);
    const [tabToClose, setTabToClose] = useState<string | null>(null);
    const [blockClose, setBlockClose] = useState(false);
    const [blockPin, setBlockPin] = useState(false);
    const [blockAppearance, setBlockAppearance] = useState(false);
    const [appearanceEdits, setAppearanceEdits] = useState(0);
    const [pins, setPins] = useState(0);
    const [dragReorders, setDragReorders] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => listenWorkspacePresentationActions(() => ({ tabs, activeTabId: active,
        sessionLoaded: true, isRestoring: false, sessionPersistenceBlocked: false,
        terminals: {}, paneLayouts: {}, contentPresentation: {} }),
    command => command.action === 'customize-tab', command => {
        if (target === command.tabId && editorKind === 'appearance') return;
        [...(listRef.current?.querySelectorAll<HTMLElement>('[data-workspace-tab]') ?? [])]
            .find(node => node.dataset.workspaceTab === command.tabId)?.focus();
        setEditorKind('appearance'); setTarget(command.tabId);
    }), [tabs, active, target, editorKind]);
    const fallbackRef = useRef<HTMLButtonElement>(null);
    const closeIntent = useRef<WorkspaceTabCloseFocusIntent | null>(null);
    const { captureCloseFocus, restoreCloseFocus } = useWorkspaceTabCloseFocus(tabs, listRef, fallbackRef, tabToClose !== null);
    const tab = tabs.find(item => item.id === target);
    const move = (id: string, direction: -1 | 1) => setTabs(current => {
        const position = current.findIndex(item => item.id === id);
        const neighbor = position >= 0 ? current[position + direction] : undefined;
        return neighbor ? reorderMainTabsById(current, id, neighbor.id) : current;
    });
    const setPinned = (id: string, pinned: boolean) => {
        const tab = tabs.find(item => item.id === id);
        if (blockPin || !tab) return false;
        setMenuError(false);
        const result = changeMainTabPresentation(tab.presentation, { type: 'set-pinned', pinned });
        if (!result.ok) return false;
        setTabs(current => stablePinnedMainTabs(current.map(item => item.id === tab.id
            ? { ...item, presentation: result.value } : item)));
        setPins(value => value + 1);
        return true;
    };
    const remove = (id: string, intent: WorkspaceTabCloseFocusIntent | null) => {
        if (blockClose || !tabs.some(item => item.id === id)) return;
        const remaining = tabs.filter(item => item.id !== id);
        setTabs(remaining);
        if (active === id) setActive(remaining[0]?.id ?? null);
        restoreCloseFocus(intent);
    };
    const cancelClose = () => { closeIntent.current = null; setTabToClose(null); };
    const requestClose = (id: string) => {
        setCloses(value => value + 1);
        const intent = captureCloseFocus(id);
        if (id === 'host') { closeIntent.current = intent; setTabToClose(id); }
        else remove(id, intent);
    };
    const changeAppearance = (action: MainTabPresentationAction) => {
        if (!tab || blockAppearance) return false;
        const result = changeMainTabPresentation(tab.presentation, action);
        if (!result.ok) return false;
        if (result.changed) {
            setTabs(current => current.map(item => item.id === tab.id ? { ...item, presentation: result.value } : item));
            setAppearanceEdits(count => count + 1);
        }
        return true;
    };
    return <TooltipProvider><main className="overlay-gallery">
        <p>Production tab controls with fixture-owned metadata. No connections, files or terminal sessions are opened.</p>
        <div data-order={tabs.map(item => item.id).join(',')} data-active={active} data-activations={activations} data-closes={closes} data-disconnects={disconnects} data-pins={pins} data-appearance-edits={appearanceEdits} data-drag-reorders={dragReorders}>
                <WorkspaceTabList ref={listRef} tabs={tabs} activeTabId={active} className="flex max-w-full items-center gap-1.5 overflow-x-auto py-3"
                    style={narrow ? { maxWidth: 220 } : undefined}
                    onReorder={(source, target) => { setDragReorders(value => value + 1); setTabs(current => reorderMainTabsById(current, source, target)); }}
                    onActivate={id => { setActive(id); setActivations(value => value + 1); }}
                    onClose={requestClose}
                    onDisconnect={() => setDisconnects(value => value + 1)}
                    onRename={id => { setEditorKind('rename'); setTarget(id); }}
                    onAppearance={id => { setEditorKind('appearance'); setTarget(id); }}
                    onSetPinned={setPinned} onMove={move} onActionError={() => setMenuError(true)}
                    closeButtonMode={closeButtonMode} canDisconnect={item => item.id === 'host'}
                    renderIcon={item => <span data-resource-icon>{item.type === 'public-urls' ? '↗' : '▣'}</span>} />
        </div>
        <Button ref={fallbackRef} id="add-workspace" type="button" variant="secondary">Add workspace</Button>
        <Button id="after-list" type="button" variant="secondary">After tab list</Button>
        <Button id="block-close" type="button" variant="secondary" aria-pressed={blockClose} onClick={() => setBlockClose(value => !value)}>Block closes</Button>
        <Button id="block-pin" type="button" variant="secondary" aria-pressed={blockPin} onClick={() => setBlockPin(value => !value)}>Block pins</Button>
        <Button id="block-appearance" type="button" variant="secondary" aria-pressed={blockAppearance} onClick={() => setBlockAppearance(value => !value)}>Block appearance</Button>
        <WorkspaceTabsSection
            closeButtonMode={closeButtonMode} onCloseButtonModeChange={setCloseButtonMode} />
        {menuError && <p role="alert">This tab could not be updated. Please try again.</p>}
        {tab && editorKind === 'rename' && <DisplayAliasDialog key={tab.id} isOpen title="Rename tab"
            defaultTitle={tab.title} displayAlias={tab.displayAlias}
            onSave={alias => setTabs(current => current.map(item => item.id === tab.id
                ? { ...item, displayAlias: normalizeDisplayAlias(alias) } : item))}
            onClose={() => setTarget(null)} />}
        {tab && editorKind === 'appearance' && <WorkspaceTabAppearanceDialog key={tab.id} tab={tab}
            onChange={changeAppearance} onClose={() => setTarget(null)} />}
        <ConfirmModal isOpen={tabToClose !== null} onClose={cancelClose} title="Disconnect & Close?"
            message="Fixture confirmation; no live sessions." confirmLabel="Disconnect"
            onConfirm={() => {
                if (tabToClose) remove(tabToClose, closeIntent.current);
                cancelClose();
            }} />
    </main></TooltipProvider>;
}

const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const tabNode = (id: string) => document.querySelector<HTMLElement>(`[data-workspace-tab="${id}"]`)!;
const stats = () => document.querySelector<HTMLElement>('[data-order]')!.dataset;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(node => node.getAttribute('aria-label') === label || node.textContent === label
        || (node.getAttribute('role') === 'menuitem' && [...node.querySelectorAll('span')].some(child => child.textContent === label)))!;
function check(value: unknown, label: string) {
    if (!value) throw new Error(label);
    result.textContent += `\nPASS ${label}`;
}
async function key(node: HTMLElement, value: string, shiftKey = false) {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, shiftKey }));
    await settle();
}
async function dismiss() {
    (button('Done') ?? button('Cancel')).click();
    await new Promise(resolve => setTimeout(resolve, 250));
    await settle();
}
const labeledControl = <T extends HTMLElement>(text: string): T => {
    const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(node => node.textContent === text);
    if (!label) throw new Error(`Missing label: ${text}`);
    return document.getElementById(label.htmlFor) as T;
};
async function choose(label: string, text: string) {
    labeledControl<HTMLButtonElement>(label).click(); await settle();
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.trim() === text);
    if (!option) throw new Error(`Missing option: ${text}`);
    option.click(); await settle();
}

/** First-open menus must escape the modal's scrolling body, including the 320px fixture. */
async function checkSelectorClipping(label: string) {
    const trigger = labeledControl<HTMLButtonElement>(label);
    trigger.scrollIntoView({ block: 'end' });
    trigger.click(); await settle();
    await new Promise(resolve => setTimeout(resolve, 200));
    const popup = document.querySelector<HTMLElement>('[data-zync-select-open="true"]')!;
    check(popupIsUnclipped(popup), `${label} popup fits its viewport without scroll-container clipping`);
    await key(document.activeElement as HTMLElement, 'Escape');
    await new Promise(resolve => setTimeout(resolve, 200));
    check(document.querySelector('[role="dialog"]') && !document.querySelector('[data-zync-select-open="true"]')
        && document.activeElement === trigger, `${label} Escape dismisses only the popup and restores its trigger`);
}
async function editInput(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true })); await settle();
}

async function openMenu(id: string, keyboard = false) {
    const trigger = tabNode(id); trigger.focus({ preventScroll: true });
    if (keyboard) await key(trigger, 'F10', true);
    else { trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 80 })); await settle(); }
}
async function moveWithKeyboard(id: string, direction: 'ArrowLeft' | 'ArrowRight') {
    const trigger = tabNode(id); trigger.focus({ preventScroll: true });
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: direction, altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await settle();
}
async function appearance(id: string) {
    await openMenu(id); button('Appearance…').click(); await settle();
}

runButton.onclick = async () => {
    runButton.disabled = true;
    result.textContent = 'Running';
    try {
        flushSync(() => root.render(<Fixture key={++runId} narrow />));
        await settle();
        const narrowStrip = document.querySelector<HTMLElement>('[data-tab-drag-strip]')!;
        await dragTabAtEdge(tabNode('host').closest<HTMLElement>('[data-tab-drag-item]')!, narrowStrip);
        check(narrowStrip.scrollLeft > 0 && stats().order === 'host,local,public', 'Overflow auto-scrolls with a stationary edge pointer and cancellation keeps order');
        check(!document.querySelector('.tab-drag-preview, [data-tab-dragging]'), 'Overflow cancellation removes feedback and stops the gesture');
        flushSync(() => root.render(<Fixture key={++runId} />));
        await settle();
        const hostSlot = tabNode('host').closest<HTMLElement>('[data-tab-drag-item]')!;
        const publicSlot = tabNode('public').closest<HTMLElement>('[data-tab-drag-item]')!;
        const originalLeft = publicSlot.getBoundingClientRect().left;
        await dragTab(hostSlot, publicSlot, { during: () => {
            const preview = document.querySelector<HTMLElement>('.tab-drag-preview')!;
            check(preview?.inert && preview.getAttribute('aria-hidden') === 'true' && !preview.querySelector('button, .lucide-x'), 'Host drag preview is inert and has no close action');
            check(hostSlot.dataset.tabDragging === 'true' && publicSlot.getBoundingClientRect().left === originalLeft
                && publicSlot.querySelector<HTMLElement>('[data-tab-drag-visual]')!.style.transform !== '', 'Shared feedback dims the source and animates chrome without moving slots');
        } });
        check(stats().order === 'local,public,host' && stats().dragReorders === '1' && stats().active === 'host' && stats().activations === '0', 'Pointer drag reorders host IDs once without activating another workspace');
        check(!document.querySelector('.tab-drag-preview, [data-tab-dragging]'), 'Drop removes shared preview and source feedback');
        check([...document.querySelectorAll<HTMLElement>('[data-tab-drag-item]')].every(slot =>
            Math.abs(slot.querySelector<HTMLElement>('[data-tab-drag-visual]')!.getBoundingClientRect().left - slot.getBoundingClientRect().left) < 1),
        'Completed sorting leaves no moving offsets over the new slots');
        tabNode('public').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
        await settle();
        check(stats().activations === '0', 'Release click cannot activate the destination tab');
        await dragTab(hostSlot, tabNode('local').closest<HTMLElement>('[data-tab-drag-item]')!, { after: false });
        check(stats().order === 'host,local,public', 'Reverse drag restores host order with the same controller');
        await dragTab(hostSlot, publicSlot, { cancel: true });
        check(stats().order === 'host,local,public' && !document.querySelector('.tab-drag-preview'), 'Escape cancels a host drag without changing order');
        const localSlot = tabNode('local').closest<HTMLElement>('[data-tab-drag-item]')!;
        await dragTab(hostSlot, localSlot, { after: false });
        check(stats().order === 'local,host,public', 'Adjacent forward drop on the near half moves the host tab instead of snapping back');
        await dragTab(hostSlot, localSlot);
        check(stats().order === 'host,local,public', 'Adjacent backward drop on the far half restores host order');
        await dragTab(hostSlot, localSlot, { after: false, stripPadding: true });
        check(stats().order === 'local,host,public', 'Host drop accepts strip padding outside the tab chrome');
        await dragTab(hostSlot, localSlot, { stripPadding: true });
        check(stats().order === 'host,local,public' && stats().dragReorders === '6'
            && stats().active === 'host' && stats().activations === '0', 'Padding drops in both directions commit once and preserve activation');
        tabNode('host').focus();
        await key(tabNode('host'), 'ArrowRight');
        check(document.activeElement === tabNode('local') && stats().active === 'host', 'Right arrow moves focus without activating');
        await key(tabNode('local'), 'End');
        check(document.activeElement === tabNode('public'), 'End focuses the last tab');
        await key(tabNode('public'), 'ArrowRight');
        check(document.activeElement === tabNode('host'), 'Right arrow wraps to the first tab');
        await key(tabNode('host'), 'ArrowLeft');
        check(document.activeElement === tabNode('public'), 'Left arrow wraps to the last tab');
        await key(tabNode('public'), 'Home');
        check(document.activeElement === tabNode('host'), 'Home focuses the first tab');
        await key(tabNode('host'), 'ArrowRight');
        await key(tabNode('local'), 'Enter');
        check(stats().active === 'local' && stats().activations === '1', 'Enter activates exactly once');
        await key(tabNode('local'), 'ArrowRight');
        await key(tabNode('public'), ' ');
        check(stats().active === 'public' && stats().activations === '2', 'Space activates exactly once');
        check(tabNode('public').textContent?.includes('Beta') && tabNode('public').title.includes('Public URLs (Beta)'), 'Public URL alias preserves Beta and canonical tooltip');
        tabNode('host').focus(); await key(tabNode('host'), 'F2');
        check(document.querySelector('[role="dialog"]')?.textContent?.includes('Rename tab')
            && !document.querySelector('[role="dialog"] details'), 'F2 opens a name-only dialog without activation');
        const field = labeledControl<HTMLInputElement>('Display name');
        await editInput(field, 'Server alias'); button('Save').click();
        await new Promise(resolve => setTimeout(resolve, 250)); await settle();
        check(tabNode('host').getAttribute('aria-label') === 'Server alias' && tabNode('host').title.includes('Production server'),
            'Saving a name retains the canonical title');
        check(document.activeElement === tabNode('host'), 'Rename restores the persistent exact-tab opener');
        await openMenu('host', true);
        check(document.activeElement === button('Rename…') && !document.querySelector('[role="dialog"]'),
            'Shift+F10 focuses the shared menu instead of opening an editor');
        await key(document.activeElement as HTMLElement, 'Escape');
        check(document.activeElement === tabNode('host') && !document.querySelector('[role="menu"]'),
            'Keyboard menu dismissal returns focus to its tab');
        await openMenu('host');
        check(document.activeElement === tabNode('host') && Boolean(document.querySelector('[role="menu"]')),
            'Pointer context menu leaves focus on the tab without an automatic item ring');
        button('Appearance…').click(); await settle();
        check(document.querySelector('[role="dialog"]')?.textContent?.includes('Tab appearance')
            && !document.querySelector('[role="dialog"]')?.textContent?.includes('Display name'),
            'Appearance editor contains only decoration, not rename, pin or order actions');
        await checkSelectorClipping('Tab icon');
        check(labeledControl<HTMLButtonElement>('Close button override').getClientRects().length > 0
            && !document.querySelector('[role="dialog"] details'), 'Close button override is visible without an Advanced disclosure');
        await checkSelectorClipping('Close button override'); await dismiss();
        check(!document.querySelector('[data-workspace-tab-item] button[aria-label^="Actions for "]'), 'Main tabs have no three-dot menu button');
        const closeAction = button('Close Server alias');
        button('After tab list').focus(); await settle();
        const labelBeforeReveal = tabNode('host').querySelector('div')!.getBoundingClientRect();
        closeAction.focus(); await key(closeAction, 'F2');
        const labelAfterReveal = tabNode('host').querySelector('div')!.getBoundingClientRect();
        const closeBounds = closeAction.getBoundingClientRect();
        check(labelBeforeReveal.left === labelAfterReveal.left && labelBeforeReveal.right === labelAfterReveal.right
            && getComputedStyle(tabNode('host').querySelector('[data-workspace-tab-label]')!).maskImage.includes('linear-gradient')
            && closeBounds.width === 24,
            'Action reveal keeps full label bounds steady and fades the trailing text instead of reserving blank space');
        check(stats().activations === '2', 'Sibling action keys never activate another tab');
        await openMenu('host', true);
        check(Boolean(document.querySelector('[role="menu"]')), 'Keyboard context menu remains available without a three-dot button');
        await key(document.activeElement as HTMLElement, 'Escape');
        button('Close Server alias').click();
        await settle();
        check(stats().closes === '1' && stats().activations === '2', 'Close action calls its owner once without activating');
        await dismiss();
        check(document.activeElement === button('Close Server alias') && Boolean(tabNode('host')), 'Cancel close restores the existing close button without removing a tab');
        tabNode('host').click();
        await settle();
        const disconnectBounds = button('Disconnect Server alias').getBoundingClientRect();
        const activeCloseBounds = button('Close Server alias').getBoundingClientRect();
        check(getComputedStyle(tabNode('host').querySelector('[data-workspace-tab-label]')!).maskImage.includes('linear-gradient')
            && disconnectBounds.width === 24 && activeCloseBounds.width === 24
            && disconnectBounds.top === activeCloseBounds.top,
            'Active host actions use aligned 24px controls with a protective label fade');
        button('Disconnect Server alias').click();
        await settle();
        check(stats().disconnects === '1' && stats().activations === '3', 'Disconnect action calls its owner once without activating');
        tabNode('public').focus();
        document.querySelector<HTMLButtonElement>('#after-list')!.focus();
        await settle();
        check(tabNode('host').tabIndex === 0 && tabNode('public').tabIndex === -1, 'Leaving the list restores the selected tab as its entry point');
        check([...document.querySelectorAll('[role="tab"]')].every(node => !node.querySelector('button')), 'Action buttons are siblings, not presentational tab descendants');
        button('Close My local shell').focus();
        button('Close My local shell').click();
        await settle();
        check(!tabNode('local') && document.activeElement === tabNode('public') && stats().active === 'host', 'Removing a focused inactive tab focuses its surviving neighbor without activation');
        button('Block closes').click();
        await settle();
        button('Close Server alias').click();
        await settle();
        button('Disconnect').click();
        await new Promise(resolve => setTimeout(resolve, 250));
        await settle();
        check(Boolean(tabNode('host')) && document.activeElement === button('Close Server alias'), 'A guarded close keeps its tab and lets the modal restore its opener');
        button('Block closes').click();
        await settle();
        button('Close Server alias').click();
        await settle();
        button('Disconnect').click();
        await new Promise(resolve => setTimeout(resolve, 250));
        await settle();
        check(!tabNode('host') && document.activeElement === tabNode('public'), 'Confirmed removal restores focus after the modal opener is removed');
        button('Close Preview links').click();
        await settle();
        check(stats().order === '' && document.activeElement === document.querySelector('#add-workspace'), 'Closing the last tab focuses the persistent Add control');
        flushSync(() => root.render(<Fixture key={++runId} />));
        await settle();
        button('Close My local shell').focus();
        button('Close My local shell').click();
        document.querySelector<HTMLButtonElement>('#after-list')!.focus();
        await settle();
        check(!tabNode('local') && document.activeElement === document.querySelector('#after-list'), 'A user moving focus elsewhere during removal is not pulled back to the tab list');
        flushSync(() => root.render(<Fixture key={++runId} />));
        await settle();
        const localNode = tabNode('local');
        await openMenu('local'); button('Pin tab').click(); await settle();
        check(stats().order === 'local,host,public' && stats().pins === '1' && tabNode('local') === localNode,
            'Menu pin moves the exact tab once, preserving its DOM node');
        check(document.activeElement === localNode, 'Menu pin returns focus to the persistent tab');
        const pinStatus = localNode.getAttribute('aria-describedby');
        check(pinStatus && document.getElementById(pinStatus)?.textContent === 'Pinned tab', 'Pinned status is separate from the tab name');
        await openMenu('local');
        check(!button('Arrange') && !button('Move left') && !button('Move right'), 'Main-tab menu has no Arrange or movement rows');
        await key(document.activeElement as HTMLElement, 'Escape');
        await moveWithKeyboard('local', 'ArrowLeft'); await moveWithKeyboard('local', 'ArrowRight');
        check(stats().order === 'local,host,public' && !document.querySelector('[role="alert"]'), 'Keyboard reordering stops quietly at pin bucket boundaries');
        await openMenu('host'); button('Pin tab').click(); await settle();
        await moveWithKeyboard('host', 'ArrowLeft');
        check(stats().order === 'host,local,public' && document.activeElement === tabNode('host'),
            'Alt+Shift+Arrow reorders within the bucket and retains exact-tab focus');
        await openMenu('host'); button('Unpin tab').click(); await settle();
        check(stats().order === 'local,host,public' && stats().activations === '0' && stats().closes === '0'
            && stats().disconnects === '0', 'Pin and keyboard reorder never activate, close or disconnect');
        button('Close My local shell').click(); await settle();
        check(!tabNode('local') && stats().closes === '1', 'Pinned tabs still use normal guarded close');
        button('Block pins').click(); await settle();
        await openMenu('host'); button('Pin tab').click(); await settle();
        check(stats().pins === '3' && Boolean(document.querySelector('[role="alert"]')), 'Refused pin reports an error without changing state');
        button('Block pins').click(); await settle();
        await openMenu('host'); button('Pin tab').click(); await settle();
        check(stats().pins === '4' && !document.querySelector('[role="alert"]'), 'Retry applies exactly once and clears the error');
        const exitingPaletteInput = document.createElement('input'); document.body.append(exitingPaletteInput);
        exitingPaletteInput.focus();
        window.dispatchEvent(new CustomEvent(WORKSPACE_PRESENTATION_EVENT, { detail: { action: 'customize-tab', tabId: 'host' } }));
        await settle(); exitingPaletteInput.remove();
        const commandField = labeledControl<HTMLButtonElement>('Tab icon');
        check(document.activeElement === commandField, 'Compatible palette command opens Appearance from a transient input');
        window.dispatchEvent(new CustomEvent(WORKSPACE_PRESENTATION_EVENT, { detail: { action: 'customize-tab', tabId: 'host' } }));
        await settle(); check(document.activeElement === commandField, 'Repeated command does not pull focus behind the editor');
        await dismiss(); check(document.activeElement === tabNode('host'), 'Palette editor restores the persistent exact tab');
        window.dispatchEvent(new CustomEvent(WORKSPACE_PRESENTATION_EVENT, { detail: { action: 'customize-tab', tabId: 'public' } }));
        await settle();
        check(!document.querySelector('[role="dialog"]') && document.activeElement === tabNode('host'), 'Inactive stale palette request cannot open an editor');
        flushSync(() => root.render(<Fixture key={++runId} />)); await settle();
        const hostTrigger = tabNode('host'), hostWrapper = hostTrigger.closest('[data-workspace-tab-item]')!;
        await appearance('host'); await choose('Tab icon', 'Star');
        check(hostWrapper.querySelector('[data-workspace-tab-icon="star"]') && tabNode('host') === hostTrigger,
            'Icon editing retains the exact live tab');
        await choose('Tab icon', 'No icon');
        check(!hostWrapper.querySelector('[data-workspace-tab-icon], [data-resource-icon]'), 'No icon hides decoration without changing the label');
        await choose('Tab icon', 'Star');
        const accent = labeledControl<HTMLInputElement>('Tab accent'); await editInput(accent, '#AbCdEf');
        check(!hostWrapper.querySelector('[data-workspace-tab-accent]'), 'Typing accent remains a draft');
        accent.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
        await settle(); check(!hostWrapper.querySelector('[data-workspace-tab-accent]'), 'IME Enter cannot apply the accent');
        button('Apply accent').click(); await settle();
        check(getComputedStyle(hostWrapper.querySelector('[data-workspace-tab-accent]')!).backgroundColor === 'rgb(171, 205, 239)'
            && document.activeElement === accent && accent.value === '#abcdef', 'Accent applies, normalizes and keeps field focus');
        await choose('Close button override', 'Hidden in tab strip'); await dismiss();
        check(!hostWrapper.querySelector('button[aria-label^="Close "]') && hostWrapper.querySelector('button[aria-label^="Disconnect "]'),
            'Legacy close override hides only the close control and retains disconnect');
        await choose('Workspace tab close button', 'Always visible');
        check(!hostWrapper.querySelector('button[aria-label^="Close "]')
            && Boolean(button('Close My local shell')), 'Per-tab override wins over the global close setting');
        await openMenu('host'); button('Pin tab').click(); await settle();
        await appearance('host'); button('Reset appearance').click(); await settle();
        check(hostWrapper.querySelector('[data-resource-icon]') && !hostWrapper.querySelector('[data-workspace-tab-accent]')
            && hostTrigger.getAttribute('aria-describedby') && hostWrapper.querySelector('button[aria-label^="Close "]'),
            'Appearance reset preserves pinning and inherits the app default');
        await dismiss(); await choose('Workspace tab close button', 'Hidden in tab strip');
        check(!document.querySelector('[data-workspace-tab-item] button[aria-label^="Close "]'), 'Global hidden mode applies to every inheriting tab');
        await appearance('host');
        await choose('Close button override', 'Always visible'); await dismiss();
        tabNode('public').click(); await settle();
        button('After tab list').focus(); await new Promise(resolve => setTimeout(resolve, 200));
        const persistentClose = hostWrapper.querySelector<HTMLButtonElement>('button[aria-label^="Close "]')!;
        check(getComputedStyle(persistentClose).opacity === '1' && getComputedStyle(persistentClose).pointerEvents === 'auto',
            'Always-visible override works on an inactive unfocused tab');
        check(getComputedStyle(hostWrapper.querySelector('[data-workspace-tab-action-fade]')!).backgroundImage.includes('linear-gradient')
            && getComputedStyle(persistentClose).backgroundColor === 'rgba(0, 0, 0, 0)',
            'Persistent close uses the shared fading gradient without its own solid backdrop');
        check(hostTrigger.querySelector('div')!.getBoundingClientRect().right <= persistentClose.getBoundingClientRect().left,
            'Persistent close has reserved title space');
        button('Block appearance').click(); await settle(); await appearance('host');
        const retryAccent = labeledControl<HTMLInputElement>('Tab accent'); await editInput(retryAccent, '#654321');
        button('Apply accent').click(); await settle();
        check(document.querySelector('[role="alert"]') && retryAccent.value === '#654321' && !hostWrapper.querySelector('[data-workspace-tab-accent]'),
            'Refused appearance retains its draft and applied state');
        button('Block appearance').click(); await settle(); button('Apply accent').click(); await settle();
        check(!document.querySelector('[role="alert"]') && retryAccent.value === '#654321', 'Retry succeeds in the same editor');
        await choose('Close button override', 'Hidden in tab strip'); await dismiss();
        await openMenu('host'); button('Close tab').click(); await settle();
        check(document.querySelectorAll('[role="dialog"]').length === 1
            && document.querySelector('[role="dialog"]')?.textContent?.includes('Disconnect & Close?'),
            'Context close hands off to one existing SSH confirmation');
        await dismiss(); check(document.activeElement === hostTrigger && hostTrigger.isConnected,
            'Cancel close restores the persistent tab even with hidden close');
        await openMenu('host'); button('Close tab').click(); await settle(); button('Disconnect').click();
        await new Promise(resolve => setTimeout(resolve, 250)); await settle();
        check(!hostTrigger.isConnected && document.activeElement === tabNode('local'), 'Confirmed context close removes only its tab and recovers neighbor focus');
        await openMenu('local'); button('Close tab').click(); await settle();
        check(!tabNode('local') && document.activeElement === tabNode('public') && !document.querySelector('[role="dialog"]'),
            'Hidden local close remains available from context with normal immediate removal');
        flushSync(() => root.render(<Fixture key={++runId} compactTitles />)); await settle();
        button('After tab list').focus(); await settle();
        const compactLocal = tabNode('local');
        const compactVisual = compactLocal.closest('[data-workspace-tab-item]')!.querySelector('[data-tab-drag-visual]')!;
        const compactWidth = compactVisual.getBoundingClientRect().width;
        const compactLabel = compactLocal.querySelector<HTMLElement>('[data-workspace-tab-label]')!;
        check(compactWidth < 104 && getComputedStyle(compactLabel).maskImage === 'none'
            && compactLabel.getBoundingClientRect().right > button('Close B').getBoundingClientRect().left,
            'Short inactive tabs stay compact and use their trailing space while actions are hidden');
        button('Close B').focus(); await settle();
        check(compactVisual.getBoundingClientRect().width === compactWidth
            && getComputedStyle(compactLabel).maskImage.includes('linear-gradient')
            && compactLocal.querySelector('[data-resource-icon]')!.getBoundingClientRect().right < button('Close B').getBoundingClientRect().left,
            'Compact close reveal preserves width and keeps the resource icon clear');
        button('Disconnect A').focus(); await settle();
        const compactHost = tabNode('host');
        const compactHostLabel = compactHost.querySelector<HTMLElement>('[data-workspace-tab-label]')!;
        const fadeEnd = compactHostLabel.getBoundingClientRect().right - 46;
        check(compactHost.querySelector('[data-resource-icon]')!.getBoundingClientRect().right < button('Disconnect A').getBoundingClientRect().left
            && fadeEnd >= compactHostLabel.getBoundingClientRect().left + 8
            && button('Disconnect A').getBoundingClientRect().right <= button('Close A').getBoundingClientRect().left,
            'Short active hosts retain visible label space and non-overlapping action hit areas');
        result.textContent += '\nALL CHECKS PASSED';
    } catch (error) { result.textContent += `\nFAIL ${error instanceof Error ? error.stack : String(error)}`; }
    finally { runButton.disabled = false; }
};
document.body.dataset.overlayGalleryTheme = 'dark';
document.querySelector<HTMLButtonElement>('#theme')!.onclick = () => {
    document.body.dataset.overlayGalleryTheme = document.body.dataset.overlayGalleryTheme === 'dark' ? 'light' : 'dark';
};
root.render(<Fixture />);
import.meta.hot?.dispose(() => root.unmount());
