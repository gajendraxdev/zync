import type { createFolderSizeFixture } from '../fixtures/files-production/folderSizes';

/** Real Files queue, preference and summaries; only native IPC is simulated. */
export async function runFolderSizeBrowserChecks(control: ReturnType<typeof createFolderSizeFixture>['control']) {
    const passed: string[] = [];
    const check = (label: string, value: unknown) => { if (!value) throw new Error(label); passed.push(label); };
    const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const wait = async (predicate: () => unknown) => {
        for (let i = 0; i < 120; i++) { if (predicate()) return; await settle(); }
        throw new Error('Folder-size UI did not settle');
    };
    const button = (label: string) => document.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]')!;
    const propertyAction = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="File properties"] button')]
        .find(node => node.textContent === label);
    const action = async (menu: string, label: string, role = 'menuitem') => {
        button(menu).click(); await settle();
        const item = [...document.querySelectorAll<HTMLButtonElement>('[role="' + role + '"]')].find(node => node.textContent?.trim() === label);
        if (!item || item.disabled) throw new Error('Missing/enabled action: ' + label);
        item.click(); await settle();
    };
    const closeDialog = async () => {
        document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click();
        await wait(() => !document.querySelector('[role="dialog"]'));
    };
    const { useAppStore } = await import('../../src/store/useAppStore');
    const host = useAppStore.getState().activeConnectionId!;
    const before = useAppStore.getState();
    const listing = before.files[host];
    const path = before.currentPath[host];
    const row = (name: string) => document.querySelector<HTMLElement>('[data-file-name="' + name + '"]')!;
    const summary = () => document.querySelector('.files-summary-count')?.textContent ?? '';
    const toggle = () => action('View', 'Show folder sizes', 'menuitemcheckbox');
    await wait(() => control.pending() === 1);
    check('missing older preference defaults to automatic bounded calculation', useAppStore.getState().settings.fileManager.showFolderSizes !== false);
    check('automatic calculation starts one scan and queues sibling folders', document.querySelectorAll('[data-folder-size-state="queued"]').length === 5);
    const queued = document.querySelector('[data-folder-size-state="queued"]')!;
    const calculating = document.querySelector('[data-folder-size-state="calculating"]')!;
    check('pending sizes hide internal text while retaining accessible status and a scan indicator', queued.textContent === '—'
        && queued.getAttribute('aria-label') === 'Queued' && !queued.querySelector('svg')
        && calculating.textContent === '' && calculating.getAttribute('aria-label') === 'Calculating…' && calculating.querySelector('svg'));
    const reads = () => control.calls.filter(call => call.command === 'fs_folder_size_calculate').length;
    row('assets').click(); await settle();
    check('selection does not restart or duplicate the active scan', reads() === 1);
    check('selected summary is bold and does not show calculating text', getComputedStyle(document.querySelector('.files-summary-count')!).fontWeight === '700'
        && !summary().includes('Calculating') && !summary().includes('Queued'));
    control.finish({ complete: false, reason: 'Entry limit reached (100,000)' });
    await wait(() => row('assets').querySelector('[data-folder-size-state="finished"]'));
    check('only incomplete results expose the info action', row('assets').textContent?.includes('Partial')
        && row('assets').querySelector('[aria-label="Folder-size details"]'));
    check('completed commands do not send redundant cancellation IPC', !control.calls.some(call => call.command === 'fs_folder_size_cancel'));
    row('assets').querySelector<HTMLButtonElement>('[aria-label="Folder-size details"]')!.click(); await settle();
    check('partial details use the single shared dialog and explain the safety stop', document.querySelectorAll('[role="dialog"]').length === 1
        && document.querySelector('[role="dialog"]')?.textContent?.includes('100,000'));
    await closeDialog();
    await wait(() => control.pending() === 1); control.finish({ bytes: '853750579' });
    await wait(() => row('config').querySelector('[data-folder-size-state="finished"]'));
    check('complete sizes have no info icon and retain their visible unit', row('config').textContent?.includes('814.2 MB')
        && !row('config').querySelector('[aria-label="Folder-size details"]'));
    const size = row('config').querySelector<HTMLElement>('[data-folder-size-state="finished"] > span')!;
    check('normal completed size text fits the existing Size column', size.scrollWidth <= size.clientWidth);
    size.click(); await settle();
    check('clicking a completed size selects its row instead of opening details', row('config').getAttribute('aria-selected') === 'true' && !document.querySelector('[role="dialog"]'));
    await wait(() => control.pending() === 1); control.finish({ bytes: '11' });
    await wait(() => row('docs').querySelector('[data-folder-size-state="finished"]'));
    row('config').click(); row('docs').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true })); await settle();
    check('two calculated folders contribute to the selected total', summary().includes('2 selected') && summary().includes('814.2 MB') && !summary().includes('Partial'));
    button('Inspect selection').click(); await settle();
    check('multi-folder Properties uses the same calculated total', document.querySelector('[aria-label="File properties"]')?.textContent?.includes('814.2 MB'));
    row('assets').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true })); await settle();
    check('including a partial folder visibly labels the aggregate incomplete', summary().includes('Partial'));
    button('Hide properties').click(); await settle();
    await action('Folder actions', 'Cancel folder-size calculation');
    control.finish(); await settle();
    const afterCancel = reads();
    await new Promise(resolve => setTimeout(resolve, 350));
    check('cancelled batches do not automatically restart', reads() === afterCancel && !document.querySelector('[data-folder-size-state="calculating"]'));
    row('scripts').click(); await settle(); button('Inspect selection').click(); await settle();
    check('cancelled scans expose an explicit retry', propertyAction('Retry calculation')?.disabled === false);
    const beforeRetry = reads();
    const retry = propertyAction('Retry calculation')!;
    retry.click(); retry.click();
    await wait(() => control.pending() === 1);
    check('repeated retry activation starts only the selected folder once', reads() === beforeRetry + 1
        && control.calls.filter(call => call.command === 'fs_folder_size_calculate').at(-1)?.path === path + '/scripts');
    row('src').click(); await settle();
    check('another cancelled folder cannot retry while a scan is active', propertyAction('Retry calculation')?.disabled === true);
    row('scripts').click(); await settle(); control.fail('Temporary metadata failure');
    await wait(() => row('scripts').querySelector('[data-folder-size-state="unavailable"]'));
    check('failed scans can retry without refreshing the directory', propertyAction('Retry calculation')?.disabled === false);
    const afterFailure = reads();
    await new Promise(resolve => setTimeout(resolve, 350));
    check('failed scans never retry automatically', reads() === afterFailure);
    propertyAction('Retry calculation')!.click(); await wait(() => control.pending() === 1);
    control.finish({ bytes: '42' });
    await wait(() => row('scripts').querySelector('[data-folder-size-state="finished"]'));
    check('a successful retry removes the action and preserves sibling results', !propertyAction('Retry calculation')
        && row('scripts').textContent?.includes('42 B') && row('config').textContent?.includes('814.2 MB'));
    button('Hide properties').click(); await settle();
    await toggle();
    check('View checkbox saves off and hides prior folder results', useAppStore.getState().settings.fileManager.showFolderSizes === false && !document.querySelector('[data-folder-size-state]'));
    control.deferAdmission(); await toggle();
    await wait(() => control.calls.at(-1)?.command === 'fs_folder_size_begin');
    const beforeAdmission = reads();
    useAppStore.setState(state => ({ currentPath: { ...state.currentPath, [host]: path + '/other' }, files: { ...state.files, [host]: [] } }));
    await settle(); control.acknowledge(); await settle();
    check('navigation during admission cancels without starting stale reads', reads() === beforeAdmission && control.calls.at(-1)?.command === 'fs_folder_size_cancel');
    useAppStore.setState(state => ({ currentPath: { ...state.currentPath, [host]: path }, files: { ...state.files, [host]: [...listing] } }));
    await wait(() => control.pending() === 1);
    control.finish({ complete: false, reason: 'Time limit reached' }); await settle();
    row('assets').querySelector<HTMLButtonElement>('[aria-label="Folder-size details"]')!.click(); await settle();
    await wait(() => control.pending() === 1);
    await toggle(); control.finish(); await settle();
    await wait(() => !document.querySelector('[role="dialog"]'));
    check('switching off cancels the queue and closes its scope-owned details', !document.querySelector('[role="dialog"]') && !document.querySelector('[data-folder-size-state]'));
    await toggle(); await wait(() => control.pending() === 1);
    useAppStore.setState(state => ({ connections: state.connections.map(connection => connection.id === host ? { ...connection } : connection) }));
    await settle(); control.finish(); await settle();
    check('connection replacement discards the previous session result', !document.querySelector('[data-folder-size-state="finished"]'));
    await wait(() => control.pending() === 1); control.finish({ bytes: '853750579' }); await settle();
    button('Grid view').click(); row('assets').click(); await settle(); button('Inspect selection').click(); await settle();
    check('Grid Properties shows completed sizes without extra calculation controls', document.querySelector('[aria-label="File properties"]')?.textContent?.includes('814.2 MB')
        && !row('assets').querySelector('[aria-label="Folder-size details"]'));
    button('Hide properties').click(); await settle();
    await wait(() => control.pending() === 1);
    useAppStore.setState(state => ({ files: { ...state.files, [host]: Array.from({ length: 1000 }, (_, i) => ({ ...listing[0], name: 'folder-' + i, path: path + '/folder-' + i })) } }));
    await settle(); control.finish(); await wait(() => control.pending() === 1);
    check('automatic scanning keeps the existing bounded-batch explanation', document.body.textContent?.includes('Automatic calculation is limited to the first 64 folders'));
    control.finish({ bytes: '1024' }); await wait(() => control.pending() === 1);
    await action('Folder actions', 'Cancel folder-size calculation');
    control.finish(); await settle();
    const listingNode = document.querySelector<HTMLElement>('[role="listbox"]')!;
    listingNode.focus();
    listingNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await wait(() => row('folder-999'));
    row('folder-999').click(); await settle();
    button('Inspect selection').click(); await settle();
    listingNode.focus();
    listingNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await wait(() => row('folder-0'));
    propertyAction('Calculate size')!.click();
    await wait(() => control.pending() === 1);
    check('a same-scope manual scan preserves earlier results and the batch-limit notice', row('folder-0').querySelector('[data-folder-size-state="finished"]')
        && document.body.textContent?.includes('Automatic calculation is limited to the first 64 folders'));
    control.finish({ bytes: '11' }); await settle();
    check('manual results are merged with existing folder totals', document.querySelector('[aria-label="File properties"]')?.textContent?.includes('11 B')
        && row('folder-0').querySelector('[data-folder-size-state="finished"]')?.getAttribute('aria-label') === '1 KB');
    button('Hide properties').click(); await settle();
    await toggle(); await settle();
    check('size projection does not mutate reported directory metadata', listing.every(file => file.type !== 'd' || file.size === 0));
    check('calculation produces no success/error toast noise', useAppStore.getState().toasts.length === before.toasts.length);
    useAppStore.setState(state => ({ files: { ...state.files, [host]: [...listing] } })); await settle();
    return passed;
}
