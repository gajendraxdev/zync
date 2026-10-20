/** Real xterm/React mouse regressions. Clipboard/native persistence are the only I/O boundaries. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { chromium } = await import(process.env.ZYNC_PLAYWRIGHT_MODULE || 'playwright');
const source = relative => fileURLToPath(new URL(relative, import.meta.url)).replaceAll('\\', '/');
const bundle = await build({
    stdin: { resolveDir: source('../'), loader: 'tsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { create } from 'zustand';
        import { Terminal } from '@xterm/xterm';
        import { bindTerminalMouse } from ${JSON.stringify(source('../src/lib/terminal/terminalMouseBinding.ts'))};
        import { registerTerminalInteraction } from ${JSON.stringify(source('../src/lib/terminal/terminalInteraction.ts'))};
        import { TerminalMouseControls } from ${JSON.stringify(source('../src/components/settings/common/TerminalMouseControls.tsx'))};
        import { TerminalContextMenu } from ${JSON.stringify(source('../src/components/terminal/TerminalContextMenu.tsx'))};
        import { TerminalHost } from ${JSON.stringify(source('../src/components/terminal/TerminalHost.tsx'))};
        import { useTerminalGlobalShortcuts } from ${JSON.stringify(source('../src/components/terminal/useTerminalGlobalShortcuts.ts'))};
        import { terminalCache } from ${JSON.stringify(source('../src/lib/terminal/terminalCache.ts'))};
        const state = window.mouseChecks = { copies: [], notices: [], reads: 0, menus: [], writes: [], panes: [],
            settings: { rightClickAction: 'context-menu', copyOnSelect: false }, failSave: false, menuSetters: [] };
        // Track only the production feedback deadline, not general xterm/React timers.
        const nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
        state.noticeTimers = new Set();
        window.setTimeout = (callback, delay, ...args) => {
            const id = nativeTimeout(() => { state.noticeTimers.delete(id); callback(...args); }, delay);
            if (delay === 1200) state.noticeTimers.add(id);
            return id;
        };
        window.clearTimeout = id => { state.noticeTimers.delete(id); nativeClear(id); };
        window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
            if (command === 'plugin:clipboard-manager|write_text') {
                state.copies.push(args.text);
                if (state.failCopy) throw new Error('Fixture clipboard write denied');
                if (state.delayCopy) return new Promise(resolve => { state.resolveCopy = resolve; });
                return;
            }
            if (command === 'plugin:clipboard-manager|read_text') {
                state.reads++;
                if (state.delayRead) return new Promise(resolve => { state.resolveRead = resolve; });
                return 'clipboard text';
            }
            throw new Error('Unexpected native command: ' + command);
        }};
        const usePreferences = create(() => ({ terminal: state.settings }));
        state.updatePreferences = patch => {
            state.settings = { ...state.settings, ...patch };
            usePreferences.setState({ terminal: state.settings });
        };
        function Controls() {
            const terminal = usePreferences(s => s.terminal);
            return <TerminalMouseControls settings={terminal} onChange={async patch => {
                state.writes.push(patch);
                if (state.failSave) throw new Error('fixture failure');
                state.updatePreferences(patch);
            }} />;
        }
        createRoot(document.getElementById('full-settings')).render(<Controls />);
        createRoot(document.getElementById('sidebar-settings')).render(<Controls />);
        function PaneMenu({ index }) {
            const [position, setPosition] = React.useState(null);
            state.menuSetters[index] = setPosition;
            return position && <TerminalContextMenu position={position} connectionId={'pane-' + index} sessionId={'pane-' + index}
                ghostSettings={{ contextMenuEnabled: false }} ghostSuggestion="" termRef={{ current: state.panes[index].term }}
                truncateLabel={label => label} onAcceptGhostSuffix={() => {}} onClose={() => setPosition(null)} />;
        }
        for (let i = 0; i < 2; i++) {
            const host = document.getElementById('pane-' + i);
            const term = new Terminal({ cols: 45, rows: 6, fontSize: 14, cursorBlink: false });
            term.open(host);
            let ready = true, epoch = 1;
            const data = [];
            term.onData(bytes => data.push(bytes));
            const target = { root: term.element, isAvailable: () => ready, epoch: () => epoch,
                selection: () => term.getSelection(), paste: text => term.paste(text), focus: () => term.focus() };
            const unregister = registerTerminalInteraction(target);
            const unbind = bindTerminalMouse(term, target, () => state.settings, position => {
                state.menus.push({ pane: i, ...position }); state.menuSetters[i]?.(position);
            }, {
                onCopied: position => state.notices.push({ pane: i, ...position }),
            });
            state.panes.push({ term, data, invalidate: () => epoch++, hide: () => { ready = false; },
                unbind: () => { unbind(); unregister(); },
                dispose: () => { unbind(); unregister(); term.dispose(); },
                write: text => new Promise(resolve => term.write(text, resolve)) });
            term.write('alpha beta gamma\\r\\ndelta epsilon\\r\\n');
        }
        createRoot(document.getElementById('menus')).render(<><PaneMenu index={0} /><PaneMenu index={1} /></>);
        function FeedbackHost() {
            const containerRef = React.useRef(null), termRef = React.useRef(null);
            const terminalSettings = usePreferences(s => s.terminal);
            const [contextMenu, setContextMenu] = React.useState(null);
            React.useLayoutEffect(() => {
                const term = new Terminal({ cols: 45, rows: 4, cursorBlink: false });
                term.open(containerRef.current);
                termRef.current = term;
                terminalCache.set('feedback', { term, spawned: true, generation: 1 });
                state.invalidateFeedback = () => { terminalCache.get('feedback').generation++; };
                term.write('selection feedback example\\r\\n');
                return () => { terminalCache.delete('feedback'); term.dispose(); termRef.current = null; };
            }, []);
            const { copied } = useTerminalGlobalShortcuts({ termRef, sessionId: 'feedback', isVisible: true,
                isKeyboardOwner: true, onOpenSearch() {}, mousePreferences: terminalSettings, onOpenContextMenu: setContextMenu });
            return <TerminalHost containerRef={containerRef} termRef={termRef} sessionId="feedback" connectionId="local"
                terminalPadding={0} terminalTransparencyEnabled={false} layoutTransitioning={false}
                isSearchOpen={false} searchText="" searchInputRef={{ current: null }}
                onSearchTextChange={() => {}} onSearchNext={() => {}} onSearchPrev={() => {}} onSearchClose={() => {}}
                contextMenu={contextMenu} copied={copied} onCloseContextMenu={() => setContextMenu(null)}
                ghostSettings={{ inlineEnabled: false }} ghostSuggestion="" truncateLabel={text => text} onAcceptGhostSuffix={() => {}} />;
        }
        const feedbackRoot = createRoot(document.getElementById('feedback'));
        state.mountFeedback = () => feedbackRoot.render(<FeedbackHost />);
        state.unmountFeedback = () => feedbackRoot.unmount();
    ` }, bundle: true, write: false, platform: 'browser', format: 'iife',
    plugins: [{ name: 'unrelated-menu-boundaries', setup(build) {
        build.onResolve({ filter: /store\/useAppStore$/ }, () => ({ path: 'menu-store', namespace: 'fixture' }));
        build.onResolve({ filter: /layout\/tabDock$/ }, () => ({ path: 'menu-files', namespace: 'fixture' }));
        build.onResolve({ filter: /lib\/terminal$/ }, () => ({ path: 'menu-cache', namespace: 'fixture' }));
        build.onResolve({ filter: /lib\/dragDrop$/ }, () => ({ path: 'unused-drag', namespace: 'fixture' }));
        build.onResolve({ filter: /terminal\/pasteFileDropToTerminal$/ }, () => ({ path: 'unused-file-paste', namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'menu-store'
            ? 'export const useAppStore = Object.assign(() => {}, { getState: () => ({ terminals: {}, connections: [] }) });'
            : path === 'menu-files' ? 'export const canDockHere = () => false, openFilesHere = () => {}, openHerePlacementItems = () => [], pickFilesOpenPath = () => "/";'
            : path === 'unused-drag' ? 'export const useInternalFileDrag = () => false;'
            : path === 'unused-file-paste' ? 'export const pasteFilePathsIntoTerminal = () => {};'
            : 'export const terminalCache = new Map();' }));
    } }],
});
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<html><body>
        <div id="panes" style="display:flex;gap:20px"><div id="pane-0"></div><div id="pane-1"></div></div>
        <div style="display:flex;gap:40px"><section id="full-settings" style="width:380px"></section><section id="sidebar-settings" style="width:280px"></section></div>
        <div id="menus"></div><button id="outside">Outside</button><div id="feedback" style="height:120px;position:relative"></div></body></html>`);
    await page.addStyleTag({ content: await readFile(new URL('../node_modules/@xterm/xterm/css/xterm.css', import.meta.url), 'utf8') });
    await page.addStyleTag({ content: '[role="menu"]{position:fixed;background:#eee;z-index:100}[role="menu"] button{display:block}[role="status"][class*="pointer-events-none"]{position:fixed;pointer-events:none;font-size:10px;line-height:14px;padding:4px 8px}' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const screen = page.locator('#pane-0 .xterm-screen');
    const rightClick = async (locator = screen) => locator.click({ button: 'right', position: { x: 30, y: 10 } });
    const counts = () => page.evaluate(() => ({ copies: mouseChecks.copies.length, reads: mouseChecks.reads,
        menus: mouseChecks.menus.length, data: mouseChecks.panes.map(p => [...p.data]) }));
    const prefs = patch => page.evaluate(patch => mouseChecks.updatePreferences(patch), patch);
    const tracking = enabled => page.evaluate(enabled => mouseChecks.panes[0].write(enabled ? '\x1b[?1000h\x1b[?1006h' : '\x1b[?1000l'), enabled);

    await tracking(true);
    await rightClick();
    let snapshot = await counts();
    assert.equal(snapshot.menus, 1, 'default menu opens');
    assert.deepEqual(snapshot.data, [[], []], 'host menu must not leak a click to the TUI');
    await page.keyboard.press('Escape');
    await prefs({ rightClickAction: 'auto' });
    await rightClick();
    snapshot = await counts();
    assert.equal(snapshot.menus, 1);
    assert.equal(snapshot.reads, 0, 'Auto never reads clipboard while the app owns mouse reporting');
    assert.equal(snapshot.data[0].length, 2, 'TUI receives exactly a press and release');
    assert.ok(snapshot.data[0].every(bytes => /^\x1b\[<2;\d+;\d+[Mm]$/.test(bytes)));
    assert.deepEqual(snapshot.data[1], [], 'sibling pane receives no bytes');
    await page.keyboard.down('Shift'); await rightClick(); await page.keyboard.up('Shift');
    assert.equal((await counts()).menus, 2, 'Shift override opens Zync menu');
    assert.equal((await counts()).data[0].length, 2, 'Shift override does not leak modified mouse reports');
    await page.keyboard.press('Escape');

    await prefs({ rightClickAction: 'paste' });
    await rightClick();
    assert.equal((await counts()).reads, 0, 'earlier Paste preference now shares Auto mouse-reporting behavior');
    await tracking(false);
    await prefs({ rightClickAction: 'auto' });
    await page.evaluate(() => mouseChecks.panes[0].term.select(0, 0, 5));
    await rightClick();
    assert.deepEqual(await page.evaluate(() => mouseChecks.copies), [], 'right-click does not copy implicitly while the toggle is off');
    assert.equal((await counts()).data[0].at(-1), 'clipboard text', 'Auto pastes even when text is selected');
    await rightClick();
    assert.equal((await counts()).reads, 2, 'next right click pastes');
    await prefs({ rightClickAction: 'passthrough' });
    const beforePass = await counts(); await rightClick();
    assert.equal((await counts()).reads, beforePass.reads + 1, 'earlier pass-through preference now shares Auto paste behavior');

    const box = await screen.boundingBox();
    await page.mouse.move(box.x + 2, box.y + 10); await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 10, { steps: 10 }); await page.mouse.up();
    assert.equal((await counts()).copies, 0, 'a real mouse selection with the toggle off does not write clipboard');
    assert.deepEqual(await page.evaluate(() => mouseChecks.notices), [], 'disabled selection copy shows no confirmation');
    await rightClick();
    assert.equal((await counts()).copies, 0, 'right-click after a real selection still cannot copy while disabled');

    await prefs({ rightClickAction: 'auto', copyOnSelect: true });
    await page.evaluate(() => mouseChecks.panes[0].term.select(0, 0, 5));
    assert.equal((await counts()).copies, 0, 'programmatic selection is not auto-copied');
    await page.mouse.move(box.x + 2, box.y + 10); await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 10, { steps: 10 });
    assert.equal((await counts()).copies, 0, 'drag updates do not write the clipboard');
    await page.mouse.up();
    await page.waitForFunction(() => mouseChecks.copies.length === 1 && mouseChecks.notices.length === 1);
    const selectionText = await page.evaluate(() => mouseChecks.panes[0].term.getSelection());
    assert.ok(selectionText.length > 1);
    assert.equal(await page.evaluate(() => mouseChecks.copies.at(-1)), selectionText, 'final selection copied once');
    const notice = await page.evaluate(() => mouseChecks.notices[0]);
    assert.equal(notice.pane, 0);
    assert.ok(notice.x >= box.x && notice.x <= box.x + box.width && notice.y >= box.y && notice.y <= box.y + box.height, 'feedback is anchored beside the selection inside its pane');
    const readsBeforeOn = (await counts()).reads;
    await rightClick();
    assert.equal((await counts()).reads, readsBeforeOn + 1, 'Auto with copy-on-selection pastes rather than copying again');
    await tracking(true);
    const beforeForcedSelection = await counts();
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 2, box.y + 10); await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 10, { steps: 8 });
    await page.mouse.up(); await page.keyboard.up('Shift');
    await page.waitForFunction(count => mouseChecks.copies.length === count + 1, beforeForcedSelection.copies);
    assert.deepEqual((await counts()).data, beforeForcedSelection.data, 'forced selection in a TUI copies without mouse reports');
    await screen.click({ button: 'middle', position: { x: 40, y: 10 } });
    assert.equal((await counts()).reads, readsBeforeOn + 1, 'middle click is not repurposed as clipboard paste');
    assert.equal((await counts()).data[0].length, beforeForcedSelection.data[0].length + 2, 'middle press and release remain available to the TUI');
    await tracking(false);
    await page.keyboard.press('Shift+F10');
    assert.equal(await page.evaluate(() => mouseChecks.menus.at(-1).keyboard), true);
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
    const beforeKeyboardContext = await counts();
    await page.evaluate(() => mouseChecks.panes[0].term.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    assert.deepEqual(await counts(), beforeKeyboardContext, 'native keyboard contextmenu cannot cause a second paste');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement === mouseChecks.panes[0].term.textarea), true, 'keyboard menu returns focus on Escape');
    await page.keyboard.press('ContextMenu');
    assert.equal((await counts()).menus, beforeKeyboardContext.menus + 1);
    await page.keyboard.press('Escape');

    await prefs({ rightClickAction: 'context-menu' });
    await rightClick();
    await page.getByRole('menu', { name: 'Terminal actions' }).waitFor();
    await rightClick(page.locator('#pane-1 .xterm-screen'));
    await page.waitForFunction(() => document.querySelectorAll('[role="menu"]').length === 1);
    assert.equal(await page.evaluate(() => mouseChecks.menus.at(-1).pane), 1, 'sibling right click replaces the old pane menu');
    await page.evaluate(() => mouseChecks.panes[0].term.focus());
    await page.keyboard.press('Shift+F10');
    await page.waitForFunction(() => document.querySelectorAll('[role="menu"]').length === 1);
    assert.equal(await page.evaluate(() => mouseChecks.menus.at(-1).pane), 0, 'keyboard opening follows pane focus');
    await page.keyboard.press('Escape');

    await prefs({ rightClickAction: 'paste' });
    await page.evaluate(() => { mouseChecks.delayRead = true; });
    await rightClick();
    await page.waitForFunction(() => typeof mouseChecks.resolveRead === 'function');
    const dataBefore = (await counts()).data;
    await page.locator('#pane-1 .xterm-screen').click({ position: { x: 20, y: 10 } });
    await page.evaluate(() => { mouseChecks.resolveRead('stale clipboard'); mouseChecks.delayRead = false; });
    assert.deepEqual((await counts()).data, dataBefore, 'delayed paste cannot follow focus to another pane');

    await page.evaluate(() => {
        const pane = mouseChecks.panes[0], screen = pane.term.element.querySelector('.xterm-screen');
        screen.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
        pane.invalidate();
        screen.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true, cancelable: true }));
    });
    assert.equal((await counts()).reads, readsBeforeOn + 2, 'reconnecting between press and contextmenu cancels the gesture');

    // Exercise the macOS Control-primary ownership branch with synthetic DOM
    // events. This does not claim native macOS/WebKit input qualification.
    const beforeControlClick = await counts();
    await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(navigator, 'platform');
        Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
        try {
            const pane = mouseChecks.panes[0], screen = pane.term.element.querySelector('.xterm-screen');
            screen.dispatchEvent(new MouseEvent('mousedown', { button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
            screen.dispatchEvent(new MouseEvent('contextmenu', { button: 2, ctrlKey: true, bubbles: true, cancelable: true }));
            document.dispatchEvent(new MouseEvent('mouseup', { button: 0, ctrlKey: true, bubbles: true, cancelable: true }));
        } finally {
            if (descriptor) Object.defineProperty(navigator, 'platform', descriptor);
            else delete navigator.platform;
        }
    });
    assert.equal((await counts()).reads, beforeControlClick.reads + 1);
    assert.equal((await counts()).data[0].length, beforeControlClick.data[0].length + 1, 'Control-primary Paste emits text only, not a primary mouse click');

    // A selection begun before transport replacement must not copy after reconnect.
    const copiesBeforeReconnect = (await counts()).copies;
    await page.mouse.move(box.x + 2, box.y + 10); await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 10, { steps: 6 });
    await page.evaluate(() => mouseChecks.panes[0].invalidate());
    await page.mouse.up();
    assert.equal((await counts()).copies, copiesBeforeReconnect);

    // Both settings surfaces use the same component/preferences and handle failed saves locally.
    const main = page.locator('#full-settings'); const sidebar = page.locator('#sidebar-settings');
    await prefs({ rightClickAction: 'context-menu', copyOnSelect: false });
    await main.getByRole('switch', { name: 'Copy on selection' }).click();
    await page.waitForFunction(() => mouseChecks.writes.length === 1);
    assert.equal(await sidebar.getByRole('switch', { name: 'Copy on selection' }).getAttribute('aria-checked'), 'true');
    await sidebar.getByRole('combobox', { name: 'Right-click action' }).click();
    await page.getByRole('option', { name: 'Pass to terminal / Paste', exact: true }).click();
    await page.waitForFunction(() => mouseChecks.writes.length === 2);
    assert.match(await main.getByRole('combobox', { name: 'Right-click action' }).innerText(), /Pass to terminal \/ Paste/);
    await page.evaluate(() => { mouseChecks.failSave = true; });
    await sidebar.getByRole('switch', { name: 'Copy on selection' }).click();
    await sidebar.getByRole('alert').waitFor();
    assert.equal(await main.getByRole('switch', { name: 'Copy on selection' }).getAttribute('aria-checked'), 'true');
    assert.deepEqual(await page.evaluate(() => mouseChecks.writes), [{ copyOnSelect: true }, { rightClickAction: 'auto' }, { copyOnSelect: false }]);
    await page.evaluate(() => { mouseChecks.failSave = false; });
    await sidebar.getByRole('switch', { name: 'Copy on selection' }).click();
    await page.waitForFunction(() => mouseChecks.writes.length === 4);
    assert.equal(await main.getByRole('switch', { name: 'Copy on selection' }).getAttribute('aria-checked'), 'false', 'failed saves do not block retry');
    const beforeCleanup = await counts();
    await page.evaluate(() => {
        mouseChecks.panes[0].unbind();
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
        mouseChecks.panes[0].term.element.dispatchEvent(event);
        if (event.defaultPrevented) throw new Error('Disposed mouse binding intercepted a later event');
    });
    assert.deepEqual(await counts(), beforeCleanup, 'disposed listeners no longer act on the clipboard or menu');
    await page.evaluate(() => { mouseChecks.panes.forEach(pane => pane.dispose()); });

    // Exercise the actual host/hook, not a duplicate feedback component or timer.
    await prefs({ rightClickAction: 'auto', copyOnSelect: true });
    await page.evaluate(() => mouseChecks.mountFeedback());
    const feedbackScreen = page.locator('#feedback .xterm-screen');
    await feedbackScreen.waitFor();
    await feedbackScreen.scrollIntoViewIfNeeded();
    const feedbackBox = await feedbackScreen.boundingBox();
    const selectFeedback = async () => {
        await page.mouse.move(feedbackBox.x + 2, feedbackBox.y + 10); await page.mouse.down();
        await page.mouse.move(feedbackBox.x + 100, feedbackBox.y + 10, { steps: 8 }); await page.mouse.up();
    };
    await selectFeedback();
    const badge = page.getByRole('status').filter({ hasText: /^Copied$/ });
    await badge.waitFor();
    const badgeBox = await badge.boundingBox();
    assert.ok(badgeBox.y >= feedbackBox.y && badgeBox.y <= feedbackBox.y + feedbackBox.height, 'Copied sits above the selection within its pane');
    assert.equal(await badge.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
    assert.equal(await page.evaluate(() => mouseChecks.noticeTimers.size), 1);
    await selectFeedback();
    await badge.waitFor();
    assert.equal(await page.evaluate(() => mouseChecks.noticeTimers.size), 1, 'consecutive copies replace one deadline');
    await prefs({ copyOnSelect: false });
    await badge.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => mouseChecks.noticeTimers.size), 0, 'disabling a visible badge clears its timer');
    await prefs({ copyOnSelect: true });
    await selectFeedback();
    await badge.waitFor();
    await badge.waitFor({ state: 'detached', timeout: 3000 });
    assert.equal(await page.evaluate(() => mouseChecks.noticeTimers.size), 0);
    const beforeFailedCopy = (await counts()).copies;
    await page.evaluate(() => { mouseChecks.failCopy = true; });
    await selectFeedback();
    await page.waitForFunction(count => mouseChecks.copies.length === count + 1, beforeFailedCopy);
    assert.equal(await badge.count(), 0, 'failed clipboard writes cannot show a success badge');
    await page.evaluate(() => { mouseChecks.failCopy = false; });
    await page.evaluate(() => { mouseChecks.delayCopy = true; });
    await selectFeedback();
    await page.waitForFunction(() => typeof mouseChecks.resolveCopy === 'function');
    assert.equal(await badge.count(), 0, 'feedback cannot precede successful clipboard completion');
    await prefs({ copyOnSelect: false });
    await page.evaluate(() => mouseChecks.resolveCopy());
    assert.equal(await badge.count(), 0, 'turning the toggle off suppresses late feedback');
    await prefs({ copyOnSelect: true });
    await page.evaluate(() => { mouseChecks.resolveCopy = null; });
    await selectFeedback();
    await page.waitForFunction(() => typeof mouseChecks.resolveCopy === 'function');
    await page.evaluate(() => { mouseChecks.invalidateFeedback(); mouseChecks.resolveCopy(); });
    assert.equal(await badge.count(), 0, 'a replaced transport cannot show stale copy feedback');
    await page.evaluate(() => { mouseChecks.resolveCopy = null; });
    await selectFeedback();
    await page.waitForFunction(() => typeof mouseChecks.resolveCopy === 'function');
    await page.evaluate(() => { mouseChecks.unmountFeedback(); mouseChecks.resolveCopy(); });
    assert.equal(await badge.count(), 0, 'closing the pane suppresses late feedback and releases its timer');
    assert.equal(await page.evaluate(() => mouseChecks.noticeTimers.size), 0);
    assert.deepEqual(errors, []);
    console.log('Real xterm mouse ownership, Auto/copy/paste, selection completion, keyboard access, pane targeting and shared settings checks passed.');
} finally { await browser.close(); }
