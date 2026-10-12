import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/** Execute production source with explicit boundary fakes, without duplicating its logic. */
export function loadSource(file, dependencies = {}, globals = {}) {
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8'), {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    runInNewContext(outputText, { module, exports: module.exports, ...globals,
        require: name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
    return module.exports;
}
