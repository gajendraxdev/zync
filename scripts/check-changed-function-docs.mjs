import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parser as rustParser } from '@lezer/rust';

/** Find source line numbers without depending on platform newline conventions. */
function lineAt(source, position) {
  return source.slice(0, position).split('\n').length;
}

/** Only named implementations count; signatures and anonymous callback expressions do not. */
function typescriptFunction(node) {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    return node.body ? { owner: node, name: node.name?.getText() ?? (ts.isConstructorDeclaration(node) ? 'constructor' : 'default') } : null;
  }
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    && (ts.isVariableDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent) || ts.isPropertyAssignment(node.parent))) {
    return { owner: node.parent, name: node.parent.name.getText() };
  }
  return null;
}

/** Read JSDoc from the declaration or its owning const statement, not a surrounding callback. */
function typescriptDocumented(owner) {
  if (ts.isVariableDeclaration(owner)) owner = owner.parent.parent;
  return ts.getJSDocCommentsAndTags(owner).some(comment => ts.isJSDoc(comment)
    && comment.getText().replace(/^\/\*\*|\*\/$/g, '').replace(/\*/g, '').trim());
}

/** TypeScript's installed compiler supplies declaration boundaries and assigned-arrow ownership. */
function typescriptFunctions(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const functions = [];
  function visit(node, scope) {
    const fn = typescriptFunction(node);
    if (fn) {
      functions.push({ key: [...scope, fn.name].join('::'), name: fn.name,
        line: lineAt(source, fn.owner.getStart(tree)), text: node.getText(tree), documented: typescriptDocumented(fn.owner) });
    }
    const namedScope = fn?.name ?? ((ts.isClassDeclaration(node) || ts.isModuleDeclaration(node)) ? node.name?.getText(tree) : undefined);
    ts.forEachChild(node, child => visit(child, namedScope ? [...scope, namedScope] : scope));
  }
  visit(tree, []);
  return functions;
}

/** Evaluate cfg with test=false; unrelated platform/features stay unknown rather than guessed. */
function rustRequiresTest(attribute) {
  const expression = attribute.match(/^\[\s*cfg\s*\(([\s\S]*)\)\s*\]$/)?.[1];
  if (!expression) return false;
  const tokens = expression.match(/"(?:[^"\\]|\\.)*"|\w+|[(),=]/g) ?? [];
  let position = 0;
  function evaluate() {
    const name = tokens[position++];
    if (tokens[position] === '=') { position += 2; return null; }
    if (tokens[position] !== '(') return name === 'test' ? false : null;
    position++;
    const values = [];
    while (position < tokens.length && tokens[position] !== ')') {
      values.push(evaluate());
      if (tokens[position] === ',') position++;
    }
    position++;
    if (name === 'not' && values.length === 1) return values[0] === null ? null : !values[0];
    if (name === 'all') return values.includes(false) ? false : values.every(value => value === true) ? true : null;
    if (name === 'any') return values.includes(true) ? true : values.every(value => value === false) ? false : null;
    return null;
  }
  return evaluate() === false;
}

/** Return the comments/outer attributes immediately preceding a declaration's modifiers. */
function rustAnnotations(tokens, start, source) {
  const annotations = [];
  for (let i = start - 1; i >= 0; i--) {
    const node = tokens[i];
    if (/^(LineComment|BlockComment)$/.test(node.name)
      || (node.name === 'BracketedTokens' && source[node.from - 1] === '#')) annotations.push(source.slice(node.from, node.to));
    else break;
  }
  return {
    documented: annotations.some(text => (/^\/\/\/[^/]/.test(text) && text.slice(3).trim())
      || (/^\/\*\*[^*]/.test(text) && text.slice(3, -2).trim()) || /^\[\s*doc\s*=\s*"[^"\n]+"/.test(text)),
    testOnly: annotations.some(text => /^\[\s*(?:\w+::)*test\s*(?:\(|\])/.test(text) || rustRequiresTest(text)),
  };
}

/** Include visibility, async/unsafe and ABI modifiers when associating Rustdoc with an item. */
function rustDeclarationStart(tokens, start, source) {
  while (start > 0) {
    const previous = source.slice(tokens[start - 1].from, tokens[start - 1].to);
    if (/^(pub|async|unsafe|const|default|extern)$/.test(previous)) start--;
    else if ((tokens[start - 1].name === 'ParenthesizedTokens' || tokens[start - 1].name === 'String')
      && start > 1 && /^(pub|extern)$/.test(source.slice(tokens[start - 2].from, tokens[start - 2].to))) start -= 2;
    else break;
  }
  return start;
}

/** Find an item's body without mistaking const-generic braces or declarations for implementations. */
function rustBody(tokens, start, source) {
  let angles = 0;
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    const text = source.slice(token.from, token.to);
    if (token.name === 'CompareOp' || token.name === 'BitOp') {
      if (/^<+$/.test(text)) angles += text.length;
      if (/^>+$/.test(text)) angles = Math.max(0, angles - text.length);
    }
    if (angles === 0 && token.name === 'BracedTokens') return i;
    if (angles === 0 && text === ';') return -1;
  }
  return -1;
}

/**
 * Parse Rust as a balanced macro token tree: comments, lifetimes, raw strings and
 * delimiters use the installed lexer, while modern let-else/let-chains inside
 * bodies cannot trigger the older semantic grammar's cascading error recovery.
 */
function rustFunctions(file, source) {
  const prefix = 'macro_rules! __function_docs { () => {';
  const wrapped = `${prefix}${source}} }`;
  // These Rust operators are missing from this older macro-token grammar.
  // Same-width whitespace preserves every source/string/comment boundary.
  const tree = rustParser.parse(wrapped.replace(/[@%~]/g, ' '));
  let malformed = false;
  tree.iterate({ enter(node) { if (node.type.isError) malformed = true; } });
  if (malformed) throw new Error(`Cannot safely inspect Rust token tree: ${file}`);
  const body = tree.topNode.getChild('MacroDefinition')?.getChild('MacroRule')?.getChild('BracedTokens');
  if (!body) throw new Error(`Missing Rust token tree: ${file}`);
  const functions = [];
  function visit(group, scope) {
    const tokens = [];
    for (let node = group.firstChild; node; node = node.nextSibling) tokens.push(node);
    for (let i = 0; i < tokens.length; i++) {
      const node = tokens[i];
      const keyword = node.name === 'Identifier' ? wrapped.slice(node.from, node.to) : '';
      if (keyword === 'fn' && tokens[i + 1]?.name === 'Identifier') {
        const end = rustBody(tokens, i + 2, wrapped);
        if (end < 0) continue;
        const start = rustDeclarationStart(tokens, i, wrapped);
        const annotation = rustAnnotations(tokens, start, wrapped);
        if (!annotation.testOnly) {
          const name = wrapped.slice(tokens[i + 1].from, tokens[i + 1].to);
          functions.push({ key: [...scope, name].join('::'), name, line: lineAt(source, tokens[start].from - prefix.length),
            text: wrapped.slice(tokens[start].from, tokens[end].to), documented: Boolean(annotation.documented) });
          visit(tokens[end], [...scope, name]);
        }
        i = end;
      } else if (['impl', 'mod', 'trait', 'macro_rules', 'macro'].includes(keyword)) {
        const end = rustBody(tokens, i + 1, wrapped);
        if (end < 0) continue;
        if (!keyword.startsWith('macro') && !rustAnnotations(tokens, rustDeclarationStart(tokens, i, wrapped), wrapped).testOnly) {
          const name = keyword === 'impl' ? wrapped.slice(node.from, tokens[end].from).replace(/\s+/g, ' ').trim()
            : wrapped.slice(tokens[i + 1].from, tokens[i + 1].to);
          visit(tokens[end], [...scope, name]);
        }
        i = end;
      } else if (/^(Braced|Parenthesized|Bracketed)Tokens$/.test(node.name)
        && !wrapped.slice(0, node.from).trimEnd().endsWith('!')) visit(node, scope);
    }
  }
  visit(body, []);
  return functions;
}

/** Collect named function implementations; tests and anonymous callback closures are out of scope. */
export function collectFunctions(file, source) {
  if (/(^|\/)(?:tests(?:\/|\.(?:rs|tsx?)$)|[^/]*(?:_tests|\.test)\.(?:rs|tsx?|mjs)$)/.test(file)) return [];
  source = source.replace(/\r\n/g, '\n');
  const functions = file.endsWith('.rs') ? rustFunctions(file, source) : typescriptFunctions(file, source);
  const duplicates = new Map();
  return functions.map(fn => {
    const count = duplicates.get(fn.key) ?? 0;
    duplicates.set(fn.key, count + 1);
    return { ...fn, key: `${fn.key}#${count}` };
  });
}

/** Compare implementation text, so an unrelated edit does not charge every function in its file. */
export function changedFunctionDocumentation(file, current, baseline) {
  const old = new Map(collectFunctions(file, baseline).map(fn => [fn.key, fn.text]));
  return collectFunctions(file, current).filter(fn => old.get(fn.key) !== fn.text).map(fn => ({ ...fn, file }));
}

/** Discover changed/untracked app code only; upstream vendor code requires an explicit comparison. */
function changedSources(base, root) {
  const tracked = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', base, '--', 'src/', 'src-tauri/src/'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'src/', 'src-tauri/src/'], { cwd: root, encoding: 'utf8' });
  return [...new Set(`${tracked}\n${untracked}`.split(/\r?\n/).filter(file => /\.(?:rs|tsx?)$/.test(file)))].sort();
}

/** Enforce diff-scoped coverage; this intentionally makes no whole-repository coverage claim. */
export function checkChangedFunctionDocs(args = process.argv.slice(2)) {
  let base = 'HEAD';
  let threshold = 80;
  const excluded = [];
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base') base = args[++i];
    else if (args[i] === '--threshold') threshold = Number(args[++i]);
    else if (args[i] === '--exclude') excluded.push(args[++i]);
    else if (args[i].startsWith('--')) throw new Error(`Unknown option ${args[i]}`);
    else files.push(args[i].replaceAll('\\', '/'));
  }
  if (!base || !Number.isFinite(threshold) || threshold < 0 || threshold > 100 || excluded.some(value => !value)) {
    throw new Error('Expected --base REF, --threshold 0..100 and --exclude PATH');
  }
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { cwd: root, stdio: 'ignore' });
  const selected = (files.length ? [...new Set(files)] : changedSources(base, root))
    .filter(file => !excluded.some(prefix => file === prefix || file.startsWith(`${prefix}/`)));
  const changed = selected.flatMap(file => {
    let baseline = '';
    try { baseline = execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { /* New/untracked files have no baseline implementations. */ }
    return changedFunctionDocumentation(file, readFileSync(path.resolve(root, file), 'utf8'), baseline);
  });
  const documented = changed.filter(fn => fn.documented).length;
  const coverage = changed.length ? documented * 100 / changed.length : 100;
  console.log(`Changed named production functions vs ${base}: ${documented}/${changed.length} documented (${coverage.toFixed(2)}%); required ${threshold.toFixed(2)}%.`);
  console.log('Scope: Rust fn implementations and TS functions/methods/constructors/assigned arrows; excludes tests, anonymous callbacks and macro templates. Not whole-repository coverage.');
  for (const file of selected) {
    const rows = changed.filter(fn => fn.file === file);
    if (rows.length) console.log(`${file}: ${rows.filter(fn => fn.documented).length}/${rows.length}`);
  }
  for (const fn of changed.filter(fn => !fn.documented)) console.log(`MISSING ${fn.file}:${fn.line} ${fn.key}`);
  return coverage >= threshold;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!checkChangedFunctionDocs()) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
