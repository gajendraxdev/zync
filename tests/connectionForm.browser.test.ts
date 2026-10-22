// This Node-only entrypoint is also checked by the DOM-oriented agent tsconfig.
// Dynamic module resolution avoids adding Node/browser typings to the application.
export {};
declare const process: { env: Record<string, string | undefined> };
const assertModule = 'node:assert/strict';
const { default: assert } = await import(assertModule);

// Like the existing browser checks, use an installed browser/runtime; never download one.
const { chromium } = await import(process.env.ZYNC_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.ZYNC_BROWSER_CHANNEL || 'msedge', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.addInitScript((platform: string) => {
        Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
    }, process.env.ZYNC_BROWSER_PLATFORM || 'Linux x86_64');
    const errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await page.goto(`${process.env.ZYNC_BROWSER_BASE_URL || 'http://127.0.0.1:1425'}/tests/connectionForm.browser.html`);
    const dialog = page.getByRole('dialog', { name: 'Add host', exact: true });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: /^New host/ }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: /^Import SSH config/ }).count(), 1);
    assert.equal(await dialog.getByRole('button', { name: /^Import file/ }).count(), 1);
    assert.equal(await page.getByLabel('Host', { exact: true }).count(), 0, 'New hosts start at the entry selector');
    await dialog.getByRole('button', { name: /^Import SSH config/ }).click();
    const importDialog = page.getByRole('dialog', { name: 'Import SSH Connections', exact: true });
    await importDialog.getByText('Multiple CertificateFile entries: only the first is imported. Review the certificate after import.', { exact: true }).waitFor();
    await importDialog.getByText('Encrypted key needs a passphrase', { exact: true }).waitFor();
    await importDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await importDialog.waitFor({ state: 'hidden' });
    await dialog.getByRole('button', { name: /^New host/ }).click();
    await page.getByLabel('Host', { exact: true }).fill('fixture.invalid');
    await page.getByLabel('Username', { exact: true }).fill('fixture');
    await page.getByLabel('Password', { exact: true }).fill('fixture-only');
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isEnabled(), true);
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: /^New host/ }).click();
    assert.equal(await page.getByLabel('Host', { exact: true }).inputValue(), 'fixture.invalid', 'Back preserves the manual draft');
    const screenshots = process.env.ZYNC_BROWSER_SCREENSHOT_DIR;
    if (screenshots) {
        await page.screenshot({ path: `${screenshots}/host-form-dark.png` });
        await page.evaluate(() => { document.body.dataset.overlayGalleryTheme = 'light'; });
        await page.waitForTimeout(250); // Let shared color transitions settle before visual inspection.
        await page.screenshot({ path: `${screenshots}/host-form-light.png` });
        await page.evaluate(() => { document.body.dataset.overlayGalleryTheme = 'dark'; });
    }

    // A delayed result belongs to the tested snapshot, never to newly edited inputs.
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.getByLabel('Host', { exact: true }).fill('changed.invalid');
    await page.getByRole('button', { name: 'Finish test', exact: true }).evaluate((button: HTMLElement) => button.click());
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('Connection successful!', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.getByRole('button', { name: 'Update connection status', exact: true }).evaluate((button: HTMLElement) => button.click());
    await page.getByRole('button', { name: 'Finish test', exact: true }).evaluate((button: HTMLElement) => button.click());
    await page.getByText('Connection successful!', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Update connection status', exact: true }).evaluate((button: HTMLElement) => button.click());
    assert.equal(await page.getByText('Connection successful!', { exact: true }).count(), 1,
        'Unrelated connection status updates do not invalidate the tested result');
    await page.getByLabel('Username', { exact: true }).fill('other');
    assert.equal(await page.getByText('Connection successful!', { exact: true }).count(), 0);

    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.getByRole('button', { name: 'Reject test', exact: true }).evaluate((button: HTMLElement) => button.click());
    await page.getByText('Connection refused. Check the host, port and whether the SSH server is running.', { exact: true }).waitFor();
    const rawError = page.getByText('Connection refused (os error 10061)', { exact: true });
    assert.equal(await rawError.isVisible(), false);
    await page.getByText('Details', { exact: true }).click();
    assert.equal(await rawError.isVisible(), true);

    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Key host fixture', exact: true }).click();
    await page.getByText('Valid unencrypted private key.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await page.getByRole('button', { name: 'Finish test', exact: true }).evaluate((button: HTMLElement) => button.click());
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('button', { name: 'Testing…', exact: true }).isDisabled(), true,
        'Old completion cannot release the reopened editor\'s pending owner');
    assert.equal(await page.getByText('Connection successful!', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Finish test', exact: true }).evaluate((button: HTMLElement) => button.click());
    await page.getByText('Connection successful!', { exact: true }).waitFor();
    assert.equal(await page.getByText('Key filename is uncommon. Confirm this is a private key.', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('User certificate (optional)', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Add certificate file', exact: true }).click();
    const certificateInput = page.getByLabel('User certificate (optional)', { exact: true });
    await certificateInput.fill('C:\\fixture\\existing-cert.pub');
    const certificateBrowse = page.getByRole('button', { name: 'Browse', exact: true }).last();
    await certificateBrowse.click();
    await page.waitForFunction(() => document.body.dataset.fixtureToast === 'error:Failed to select certificate: fixture dialog failure');
    assert.equal(await certificateInput.inputValue(), 'C:\\fixture\\existing-cert.pub', 'Picker failure preserves the configured certificate');
    await certificateBrowse.click();
    await page.waitForFunction(() => document.body.dataset.fixtureToast === 'error:Failed to select certificate: fixture string failure');
    await certificateBrowse.click();
    assert.equal(await certificateInput.inputValue(), 'C:\\fixture\\picked-cert.pub', 'String picker result updates the certificate');
    await certificateBrowse.click();
    assert.equal(await certificateInput.inputValue(), 'C:\\fixture\\picked-cert.pub', 'Cancelling the picker preserves the certificate');
    await page.getByLabel('User certificate (optional)', { exact: true }).fill('bad\0certificate');
    await page.getByText('Certificate path contains invalid characters.', { exact: true }).first().waitFor();
    assert.equal(await page.getByLabel('User certificate (optional)', { exact: true }).getAttribute('aria-invalid'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    await page.getByLabel('User certificate (optional)', { exact: true }).fill('C:\\fixture\\client-cert.pub');
    if (screenshots) await page.screenshot({ path: `${screenshots}/host-form-certificate.png` });
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    assert.equal(await page.getByLabel('User certificate (optional)', { exact: true }).count(), 0);

    await page.getByRole('button', { name: /^Advanced/ }).click();
    await page.getByLabel('Network interface', { exact: true }).click();
    await page.getByRole('option', { name: /Wi-Fi fixture/ }).click();
    await page.getByRole('dialog', { name: 'Edit host', exact: true }).getByText('192.0.2.5, fe80::12', { exact: true }).waitFor();
    await page.getByRole('dialog', { name: 'Edit host', exact: true }).getByText('Fixture wireless driver', { exact: true }).waitFor();
    await page.getByLabel('Network interface', { exact: true }).click();
    await page.getByRole('option', { name: 'Ask every time', exact: true }).click();
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    const networkDialog = page.getByRole('dialog', { name: 'Choose network interface', exact: true });
    await networkDialog.waitFor();
    assert.equal(await networkDialog.getByText(/fixture@fixture.invalid:22222/).count(), 1);
    await networkDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await networkDialog.waitFor({ state: 'hidden' });

    for (const viewport of [{ width: 1100, height: 900 }, { width: 640, height: 520 }, { width: 390, height: 700 }]) {
        await page.setViewportSize(viewport);
        const bounds = await page.getByRole('dialog', { name: 'Edit host', exact: true }).boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1
            && bounds.y + bounds.height <= viewport.height + 1, 'Dialog stays within the viewport');
        assert.equal(await page.getByRole('button', { name: 'Save & Connect', exact: true }).isVisible(), true);
        const footerStyle = await page.getByRole('group', { name: 'Save connection actions' }).evaluate((toolbar: HTMLElement) => {
            const footer = toolbar.parentElement!.parentElement!;
            const style = getComputedStyle(footer);
            return { blur: style.backdropFilter, left: parseFloat(style.borderBottomLeftRadius), right: parseFloat(style.borderBottomRightRadius) };
        });
        assert.equal(footerStyle.blur, 'none', 'Footer must not create a backdrop-filter layer outside the modal clip');
        assert.ok(footerStyle.left > 0 && footerStyle.right > 0, 'Both footer corners follow the dialog radius');
    }
    assert.deepEqual(errors, []);
    console.log('Host onboarding browser regressions passed');
} finally {
    await browser.close();
}
