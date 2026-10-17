import type { createPermissionFixture } from '../fixtures/files-production/permissions';

/** Typed regressions in the real FileManager fixture; the runner only supplies a
 * browser. No production implementation is copied into this check module.
 */
export async function runFilePermissionBrowserChecks(fixture: ReturnType<typeof createPermissionFixture>, surfaceActive: (active: boolean) => void): Promise<string[]> {
    const passed: string[] = [];
    const check = (label: string, value: unknown) => { if (!value) throw new Error(label); passed.push(label); };
    const until = async (predicate: () => unknown) => {
        const deadline = performance.now() + 10_000;
        while (!predicate()) {
            if (performance.now() > deadline) throw new Error(`Permission UI did not settle: ${document.body.innerText.slice(-1600)}`);
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
    };
    const button = (label: string): HTMLButtonElement => {
        const result = [...document.querySelectorAll<HTMLButtonElement>('button')]
            .find(element => (element.getAttribute('aria-label') || element.textContent?.trim()) === label);
        if (!result) throw new Error(`Missing button ${label}: ${document.body.innerText.slice(-1600)}`);
        return result;
    };
    const select = async (name: string) => {
        await until(() => document.querySelector(`[data-file-name="${name}"]`));
        const element = document.querySelector<HTMLElement>(`[data-file-name="${name}"]`);
        if (!element) throw new Error(`Missing file ${name}`);
        element.click();
        await until(() => element.getAttribute('aria-selected') === 'true');
    };
    const inspector = () => document.querySelector<HTMLElement>('[aria-label="File properties"]')!;
    const editReady = () => [...document.querySelectorAll<HTMLButtonElement>('button')].some(el => el.textContent?.trim() === 'Edit permissions' && !el.disabled);
    const setOctal = async (value: string) => {
        const input = inspector().querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => input.value === value);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    };
    const refresh = async () => {
        const before = fixture.control.reads.length;
        button('Refresh').click();
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await until(() => fixture.control.reads.length > before && !inspector().textContent?.includes('Reading permissions…'));
    };

    await until(() => document.querySelector('[role="listbox"]'));
    check('opening Files does not probe permissions for rows', fixture.control.reads.length === 0);
    await select('README.md');
    button('Inspect selection').click();
    await until(editReady);
    check('Properties reads one selected target without mutating it', fixture.control.reads.length === 1 && fixture.control.writes.length === 0);
    check('special bits and numeric root ownership are displayed without denying the owner', inspector().textContent?.includes('2640') && inspector().textContent?.includes('UID 0') && !button('Edit permissions').disabled);
    button('Edit permissions').click();
    await until(() => inspector().querySelectorAll('input[type="checkbox"]').length === 9);
    await until(() => document.activeElement?.getAttribute('aria-label') === 'Owner read');
    check('explicit editing moves focus to its first labelled native checkbox', document.activeElement?.getAttribute('aria-label') === 'Owner read');
    check('all nine native checkboxes have accessible labels', [...inspector().querySelectorAll('input[type="checkbox"]')].every(el => Boolean(el.getAttribute('aria-label'))));
    const groupRead = inspector().querySelector<HTMLInputElement>('[aria-label="Group read"]')!;
    groupRead.click();
    await until(() => !groupRead.checked);
    check('editing a checkbox never writes on change', fixture.control.writes.length === 0);
    button('Discard draft').click();
    await until(() => !inspector().querySelector('input'));
    await until(() => document.activeElement === button('Edit permissions'));
    check('discard returns focus to the same target’s Edit action', document.activeElement === button('Edit permissions'));
    check('discarding the draft does not mutate permissions', fixture.control.writes.length === 0);
    button('Edit permissions').click();
    await until(() => Boolean(inspector().querySelector('input')));
    await setOctal('888');
    check('invalid octal is described and cannot be applied', button('Apply').disabled && inspector().querySelector('[aria-invalid="true"]'));
    await setOctal('644');
    check('ordinary mode diff never includes special bits', !button('Apply').disabled && inspector().textContent?.includes('640 → 644'));
    fixture.control.deferApply();
    button('Apply').click(); button('Apply').click();
    await until(fixture.control.applyPending);
    check('double Apply admits one write and freezes the draft', fixture.control.writes.length === 1
        && inspector().querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled);
    const originalPath = fixture.control.writes[0].path;
    await select('package.json');
    fixture.control.finishApply();
    await until(() => fixture.control.reads.at(-1)?.endsWith('/package.json') && editReady());
    check('selection changes during Apply cannot bind the old reply to the next item', fixture.control.writes[0].path === originalPath
        && inspector().textContent?.includes('package.json') && !inspector().textContent?.includes('Permissions updated;'));
    check('only ordinary disjoint masks cross native IPC', fixture.control.writes[0].setBits === 0o004 && fixture.control.writes[0].clearBits === 0);

    fixture.control.reconnect();
    button('Edit permissions').click();
    await until(() => Boolean(inspector().querySelector('input')));
    await setOctal('600');
    button('Apply').click();
    await until(() => inspector().textContent?.includes('Connection changed.'));
    check('a stale session requires a fresh review, without a write replay', fixture.control.writes.length === 1 && button('Apply').disabled);
    await refresh();
    await until(editReady);
    fixture.control.setOutcome('unknown');
    button('Edit permissions').click();
    await until(() => Boolean(inspector().querySelector('input')));
    await setOctal('600');
    button('Apply').click();
    await until(() => inspector().textContent?.includes('outcome requires review'));
    check('uncertain outcomes require Refresh and never auto-retry', fixture.control.writes.length === 2 && button('Edit permissions').disabled);
    fixture.control.setOutcome('verified');
    fixture.control.setModel('windows');
    await refresh();
    check('Windows exposes read-only attributes, not synthetic Unix chmod', button('Edit permissions').disabled
        && inspector().textContent?.includes('access-control lists') && !inspector().textContent?.includes('Current mode'));
    fixture.control.setModel('posix'); fixture.control.setKind('Symlink');
    await refresh();
    check('links remain read-only with an accessible reason', button('Edit permissions').disabled && inspector().textContent?.includes('not editable'));
    fixture.control.setKind('Directory'); fixture.control.setMode(0o40755);
    await refresh(); await until(editReady);
    button('Edit permissions').click();
    await until(() => Boolean(inspector().querySelector('[aria-label="Owner traverse"]')));
    check('directory execute bits are labelled as traversal', inspector().querySelectorAll('[aria-label$="traverse"]').length === 3);

    fixture.control.deferApply();
    await setOctal('700');
    button('Apply').click();
    await until(fixture.control.applyPending);
    button('Hide properties').click();
    await until(() => document.querySelector('[aria-label="Inspect selection"]'));
    fixture.control.finishApply();
    await until(() => !fixture.control.applyPending());
    button('Inspect selection').click();
    await until(editReady);
    check('closing during Apply does not cancel the native request or leave reopening stuck', !button('Edit permissions').disabled);

    button('Hide properties').click();
    await until(() => document.querySelector('[aria-label="Inspect selection"]'));
    await select('README.md');
    fixture.control.deferRead();
    button('Inspect selection').click();
    await until(fixture.control.readPending);
    await select('package.json');
    const readsBeforeChurn = fixture.control.reads.length;
    for (let index = 0; index < 20; index++) await select(index % 2 ? 'package.json' : 'README.md');
    check('rapid selection changes keep one native permission read outstanding', fixture.control.reads.length === readsBeforeChurn);
    fixture.control.finishRead();
    await until(editReady);
    check('late metadata cannot replace a newer selected target', inspector().textContent?.includes('package.json') && !inspector().textContent?.includes('README.md'));
    check('the compact inspector does not overflow horizontally', inspector().scrollWidth <= inspector().clientWidth + 1);
    fixture.control.setKind('File'); fixture.control.setMode(0o102644);
    await refresh(); await until(editReady);
    button('Edit permissions').click();
    await until(() => inspector().querySelectorAll('input[type="checkbox"]').length === 9);
    fixture.control.deferRefresh();
    await setOctal('600');
    button('Apply').click();
    await until(fixture.control.refreshPending);
    await until(editReady);
    check('a slow listing refresh cannot keep verified permissions locked', inspector().textContent?.includes('current mode verified'));
    button('Edit permissions').click();
    await until(() => Boolean(inspector().querySelector('input')));
    fixture.control.rejectRefresh();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    check('a late listing failure cannot overwrite a new permission draft', Boolean(inspector().querySelector('input'))
        && !inspector().textContent?.includes('Folder listing refresh failed'));
    const sentinel = document.createElement('button');
    sentinel.textContent = 'Outside permission inspector'; document.body.append(sentinel); sentinel.focus();
    surfaceActive(false);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    check('hiding Files never restores permission-editor focus into its inactive pane', document.activeElement === sentinel);
    const readsBeforeActivation = fixture.control.reads.length;
    surfaceActive(true);
    await until(() => fixture.control.reads.length > readsBeforeActivation);
    await until(editReady);
    sentinel.remove();
    button('Edit permissions').click();
    await until(() => inspector().querySelectorAll('input[type="checkbox"]').length === 9);
    return passed;
}
