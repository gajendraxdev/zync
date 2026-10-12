import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const relativePath = file => path.relative(sourceRoot, file).split(path.sep).join('/');
const sourceFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(entry.name) ? [file] : [];
});

/** Inspect syntax rather than text so multiline/type imports, re-exports and lazy
 * imports are checked without executing application code or matching comments.
 * This is a dependency regression guard, not a sandbox or a general purity proof.
 */
function moduleReferences(source, file) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const references = [];
    const add = (node, typeOnly) => references.push({ specifier: node && ts.isStringLiteralLike(node) ? node.text : null, typeOnly });
    const visit = node => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            const bindings = clause?.namedBindings;
            const namedTypesOnly = bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0
                && bindings.elements.every(binding => binding.isTypeOnly);
            add(node.moduleSpecifier, !!clause?.isTypeOnly || (!clause?.name && !!namedTypesOnly));
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
            const namedTypesOnly = node.exportClause && ts.isNamedExports(node.exportClause)
                && node.exportClause.elements.length > 0 && node.exportClause.elements.every(binding => binding.isTypeOnly);
            add(node.moduleSpecifier, node.isTypeOnly || !!namedTypesOnly);
        } else if (ts.isImportTypeNode(node)) {
            add(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined, true);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            add(node.moduleReference.expression, node.isTypeOnly);
        } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
            add(node.arguments[0], false);
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    return references;
}

const pureRoots = ['features/workspace/domain/', 'features/appearance/domain/', 'lib/paneLayout/'];
const uiPackages = new Set(['react', 'react-dom', 'lucide-react', 'framer-motion', 'cmdk', 'clsx', 'tailwind-merge']);
const purePolicy = (from, target, typeOnly, external) => external
    // Existing geometry styling uses a compile-time CSS shape; no React runtime.
    ? from === 'lib/paneLayout/intro.ts' && typeOnly && target === 'react'
    : pureRoots.some(root => target.startsWith(root));
const uiPolicy = (_from, target, _typeOnly, external) => external
    ? uiPackages.has(target)
    : target.startsWith('components/ui/') || target === 'lib/utils.ts';

/** Follow local dependencies too: a UI helper/barrel must not hide a store import.
 * Explicit relative paths are the contract here; aliases/external additions must
 * be deliberately reviewed. The injected file port is used by guard self-tests.
 */
function dependencyViolations(entries, policy, files = { exists: existsSync, read: file => readFileSync(file, 'utf8') }) {
    const visited = new Set();
    const violations = [];
    const pending = [...entries];
    while (pending.length) {
        const file = pending.pop();
        if (visited.has(file)) continue;
        visited.add(file);
        if (file.endsWith('.json')) continue;
        for (const { specifier, typeOnly } of moduleReferences(files.read(file), file)) {
            const from = relativePath(file);
            if (specifier === null) { violations.push(`${from}: computed module dependency`); continue; }
            const external = !specifier.startsWith('.');
            let target = specifier;
            if (!external) {
                const base = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ''));
                target = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
                    .find(candidate => files.exists(candidate) && /\.(?:tsx?|json)$/.test(candidate));
                if (!target) { violations.push(`${from}: unresolved ${specifier}`); continue; }
            }
            if (!policy(from, external ? target : relativePath(target), typeOnly, external)) {
                violations.push(`${from}: disallowed ${typeOnly ? 'type' : 'runtime'} dependency ${specifier}`);
            } else if (!external) pending.push(target);
        }
    }
    return violations.sort();
}

test('workspace/appearance domains and their geometry dependencies do not import renderer, store or platform layers', () => {
    const entries = pureRoots.flatMap(root => sourceFiles(path.join(sourceRoot, root)));
    assert.ok(entries.length > 0, 'The guarded source set must exist');
    assert.deepEqual(dependencyViolations(entries, purePolicy), []);
});

test('migrated shared primitives and their helpers stay independent of feature and native state', () => {
    const entries = ['Button', 'Input', 'Select', 'Switch', 'IconButton', 'PanelHeader', 'Toolbar', 'Textarea',
        'StateMessage', 'Modal', 'ContextMenu', 'MenuSubmenu', 'TopbarDropdown']
        .map(name => path.join(sourceRoot, 'components/ui', `${name}.tsx`));
    assert.deepEqual(dependencyViolations(entries, uiPolicy), []);
});

test('dependency inspection handles static, type-only, re-export and lazy syntax, ignoring comments and strings', () => {
    const references = moduleReferences(`
        // import 'ignored-comment';
        const text = "require('ignored-string')";
        import './side-effect';
        import type { A } from './a';
        import { type B, type C } from './b';
        import Default, { type D } from './mixed';
        export { type E } from './e';
        export * from './barrel';
        type T = import('./inline').T;
        import Old = require('./old');
        const lazy = () => import('./lazy');
        require('./commonjs');
        import(variable);
    `, 'fixture.ts');
    assert.deepEqual(references, [
        ['./side-effect', false], ['./a', true], ['./b', true], ['./mixed', false], ['./e', true],
        ['./barrel', false], ['./inline', true], ['./old', false], ['./lazy', false], ['./commonjs', false], [null, false],
    ].map(([specifier, typeOnly]) => ({ specifier, typeOnly })));
});

test('guard catches indirect, alias, type-only and computed violations without loading forbidden modules', () => {
    const sources = new Map(Object.entries({
        'components/ui/Example.tsx': "export * from './helper.js'; import type { State } from '../../store/state';",
        'components/ui/helper.ts': "import '@/store'; import('../../store/state'); require(name);",
        'store/state.ts': 'throw new Error("must not execute")',
    }).map(([file, source]) => [path.join(sourceRoot, file), source]));
    const actual = dependencyViolations([path.join(sourceRoot, 'components/ui/Example.tsx')], uiPolicy,
        { exists: file => sources.has(file), read: file => sources.get(file) });
    assert.deepEqual(actual, [
        'components/ui/Example.tsx: disallowed type dependency ../../store/state',
        'components/ui/helper.ts: computed module dependency',
        'components/ui/helper.ts: disallowed runtime dependency ../../store/state',
        'components/ui/helper.ts: disallowed runtime dependency @/store',
    ]);
});

test('the legacy React type exception cannot admit runtime React or new domain coupling', () => {
    assert.equal(purePolicy('lib/paneLayout/intro.ts', 'react', true, true), true);
    assert.equal(purePolicy('lib/paneLayout/intro.ts', 'react', false, true), false);
    assert.equal(purePolicy('features/workspace/domain/example.ts', 'react', true, true), false);
    assert.equal(purePolicy('features/workspace/domain/example.ts', 'features/workspace/application/service.ts', false, false), false);
});
