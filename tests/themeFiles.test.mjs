import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { loadWorkspaceDomain as load } from './helpers/loadWorkspaceDomain.mjs';

const domain = load('features/appearance/domain/themeDocument.ts');
const theme = JSON.parse(readFileSync(new URL('./fixtures/themeDocument.json', import.meta.url), 'utf8')).theme;
const source = readFileSync(new URL('../src/features/appearance/application/themeFiles.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
function files({ open = async () => 'theme.json', save = async () => 'export.json', invoke = async () => JSON.stringify(theme) } = {}) {
    const module = { exports: {} };
    runInNewContext(outputText, { module, exports: module.exports, require: name => {
        if (name === '@tauri-apps/api/core') return { isTauri: () => true, invoke };
        if (name === '@tauri-apps/plugin-dialog') return { open, save };
        if (name === '../domain/themeDocument') return domain;
        assert.fail(`Unexpected file dependency ${name}`);
    } });
    return module.exports;
}

test('native file picker uses a bounded local read and the shared validator', async () => {
    const calls = [];
    const port = files({ invoke: async (command, args) => { calls.push({ command, args }); return JSON.stringify(theme); } });
    const imported = await port.themeFiles.pick();
    assert.equal(imported.elements.overrides['terminal.cursor'], '#abcdef');
    assert.equal(calls.length, 1); assert.equal(calls[0].command, 'fs_read_file');
    assert.equal(calls[0].args.maxBytes, domain.THEME_FILE_MAX_BYTES); assert.equal(calls[0].args.connectionId, 'local');
    await assert.rejects(files({ invoke: async () => '{broken' }).themeFiles.pick(), /Invalid JSON/);
    assert.equal(await files({ open: async () => null, invoke: () => assert.fail('cancel must not read') }).themeFiles.pick(), null);
});

test('export validates before prompting, only writes the approved file and reports cancellation', async () => {
    const writes = [];
    const port = files({ invoke: async (command, args) => writes.push({ command, args }) });
    assert.equal(await port.themeFiles.export(theme), true);
    assert.equal(writes.length, 1); assert.equal(writes[0].command, 'fs_write_file');
    assert.equal(writes[0].args.path, 'export.json'); assert.equal(writes[0].args.connectionId, 'local');
    assert.equal(writes[0].args.content, domain.writeThemeJson(theme));
    assert.equal(await files({ save: async () => null, invoke: () => assert.fail('cancel must not write') }).themeFiles.export(theme), false);
    await assert.rejects(files({ save: () => assert.fail('invalid theme must not prompt') }).themeFiles.export({ version: 99 }), /Expected/);
    await assert.rejects(files({ invoke: async () => { throw new Error('write refused'); } }).themeFiles.export(theme), /write refused/);
});

test('browser reads enforce file size before loading content and validate with the same codec', async () => {
    const port = files();
    await assert.rejects(port.readBrowserThemeFile({ size: domain.THEME_FILE_MAX_BYTES + 1, text: () => assert.fail('oversized file must not load') }), /64 KB/);
    const imported = await port.readBrowserThemeFile({ size: 1024, text: async () => JSON.stringify(theme) });
    assert.equal(imported.name, 'Ocean');
    await assert.rejects(port.readBrowserThemeFile({ size: 1, text: async () => '[]' }), /Expected/);
});
