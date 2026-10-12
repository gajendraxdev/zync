import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Pure modules have no desktop I/O, store, timers or renderer dependencies.
const cache = new Map();
export function loadWorkspaceDomain(relative) {
    const file = path.isAbsolute(relative) ? relative : fileURLToPath(new URL(`../../src/${relative}`, import.meta.url));
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, { module, exports: module.exports, TextEncoder, require: name => {
        assert.ok(name.startsWith('.'), `Unexpected non-domain dependency: ${name}`);
        if (name.endsWith('.json')) return { default: JSON.parse(readFileSync(path.resolve(path.dirname(file), name), 'utf8')) };
        const base = path.resolve(path.dirname(file), name.replace(/\.js$/, ''));
        const found = [base + '.ts', path.join(base, 'index.ts')].find(existsSync);
        assert.ok(found, name); return loadWorkspaceDomain(found);
    } });
    return module.exports;
}
