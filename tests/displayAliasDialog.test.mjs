import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import rehypeRaw from 'rehype-raw';
import ts from 'typescript';
import { Button } from '../.tmp-agent-tests/src/components/ui/Button.js';
import { Input } from '../.tmp-agent-tests/src/components/ui/Input.js';
import { Toolbar } from '../.tmp-agent-tests/src/components/ui/Toolbar.js';

const require = createRequire(import.meta.url);

/** Run current presentation source while isolating the portal, not the alias policy. */
function loadSource(path, boundaries = {}) {
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, {
        module, exports: module.exports,
        require: name => Object.hasOwn(boundaries, name) ? boundaries[name] : require(name),
    });
    return module.exports;
}

const presentation = loadSource('src/features/workspace/domain/presentation.ts');
function loadDialog(hooks = {}) {
    return loadSource('src/components/workspace/DisplayAliasDialog.tsx', {
        react: { ...React, ...hooks },
        '../../features/workspace/domain/presentation': presentation,
        '../ui/Button': { Button },
        '../ui/Input': { Input },
        '../ui/Toolbar': { Toolbar },
        '../ui/Modal': { Modal: ({ isOpen, children }) => isOpen ? children : null },
    }).DisplayAliasDialog;
}

const elements = node => React.isValidElement(node)
    ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
const descendants = node => [node, ...(node.children ?? []).flatMap(descendants)];

/** In-memory hook slots exercise callback contracts; real mounting/focus lives in the browser fixture. */
function createEditor(overrides = {}) {
    const slots = [];
    let cursor = 0;
    const slot = initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return index;
    };
    const Dialog = loadDialog({
        useState: initial => {
            const index = slot(initial);
            return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
        },
        useRef: initial => slots[slot({ current: initial })],
        useId: () => slots[slot('fixture-display-name')],
    });
    const saves = [];
    let closes = 0;
    let props = { isOpen: true, defaultTitle: 'Original host', onSave: value => saves.push(value), onClose: () => { closes += 1; }, ...overrides };
    const render = (patch = {}) => {
        props = { ...props, ...patch };
        cursor = 0;
        const dialog = Dialog(props);
        const body = dialog.props.children;
        return body ? body.type(body.props) : null;
    };
    const input = tree => elements(tree).find(node => node.type === Input);
    const button = (tree, label) => elements(tree).find(node => node.type === Button && node.props.children === label);
    const change = value => input(render()).props.onChange({ target: { value } });
    const submit = () => render().props.onSubmit({ preventDefault() {} });
    return { render, input, button, change, submit, saves, get closes() { return closes; } };
}

test('dialog names its field, explains presentation-only scope, and associates unique help text', () => {
    const Dialog = loadDialog();
    const html = renderToStaticMarkup(React.createElement('div', null,
        React.createElement(Dialog, { isOpen: true, defaultTitle: '<host>', onSave() {}, onClose() {} }),
        React.createElement(Dialog, { isOpen: true, defaultTitle: 'Other host', onSave() {}, onClose() {} }),
    ));
    const tree = rehypeRaw()({ type: 'root', children: [{ type: 'raw', value: html }] });
    const nodes = descendants(tree);
    const inputs = nodes.filter(node => node.tagName === 'input');
    assert.equal(inputs.length, 2);
    assert.notEqual(inputs[0].properties.id, inputs[1].properties.id);
    for (const input of inputs) {
        const label = nodes.find(node => node.tagName === 'label' && node.properties.htmlFor?.includes(input.properties.id));
        assert.equal(label.children[0].value, 'Display name');
        for (const id of input.properties.ariaDescribedBy) assert.ok(nodes.some(node => node.properties?.id === id));
    }
    assert.match(html, /not host names, files, or connections/);
    assert.match(html, /&lt;host&gt;/);
    for (const button of nodes.filter(node => node.tagName === 'button')) {
        assert.equal(button.properties.type, button.children[0]?.value === 'Save' ? 'submit' : 'button');
    }
});

test('draft starts from alias and survives dynamic title and alias prop changes while open', () => {
    const editor = createEditor({ displayAlias: 'Current alias' });
    assert.equal(editor.input(editor.render()).props.value, 'Current alias');
    editor.change('Draft label');
    const next = editor.render({ defaultTitle: 'Live shell title', displayAlias: 'Externally updated alias' });
    assert.equal(editor.input(next).props.value, 'Draft label');
    assert.equal(editor.input(next).props.placeholder, 'Live shell title');
});

test('save normalizes Unicode presentation text once and closes once', () => {
    const editor = createEditor();
    editor.change('  e\u0301  山  ');
    editor.submit();
    editor.submit();
    assert.deepEqual(editor.saves, ['é 山']);
    assert.equal(editor.closes, 1);
});

test('overlong drafts remain editable and 80 astral characters are accepted without truncation', () => {
    const editor = createEditor();
    const overlong = '😀'.repeat(81);
    editor.change(overlong);
    editor.submit();
    assert.deepEqual(editor.saves, []);
    assert.equal(editor.closes, 0);
    assert.equal(editor.input(editor.render()).props.value, overlong);
    assert.match(editor.input(editor.render()).props.error, /80 characters/);
    editor.change('😀'.repeat(80));
    assert.equal(editor.input(editor.render()).props.error, undefined);
    editor.submit();
    assert.deepEqual(editor.saves, ['😀'.repeat(80)]);
});

test('draft length follows canonical text cleanup, including NFC contraction and expansion', () => {
    for (const [draft, expected] of [
        ['e\u0301'.repeat(80), 'é'.repeat(80)],
        ['Build' + ' \t\u202e'.repeat(100) + 'host', 'Build host'],
    ]) {
        const editor = createEditor();
        editor.change(draft);
        editor.submit();
        assert.deepEqual(editor.saves, [expected]);
        assert.equal(editor.closes, 1);
    }
    const expanding = createEditor();
    expanding.change('\u0344'.repeat(41));
    expanding.submit();
    assert.deepEqual(expanding.saves, []);
    assert.equal(expanding.closes, 0);
    assert.match(expanding.input(expanding.render()).props.error, /80 characters/);
});

test('Cancel never saves; Reset and blank Save restore the default through undefined', () => {
    const cancelled = createEditor({ displayAlias: 'Alias' });
    cancelled.change('Unsaved');
    cancelled.button(cancelled.render(), 'Cancel').props.onClick();
    assert.deepEqual(cancelled.saves, []);
    assert.equal(cancelled.closes, 1);
    const reset = createEditor({ displayAlias: 'Alias' });
    reset.button(reset.render(), 'Reset to default').props.onClick();
    reset.submit();
    assert.deepEqual(reset.saves, [undefined]);
    assert.equal(reset.closes, 1);
    const blank = createEditor();
    blank.change('   ');
    blank.submit();
    assert.deepEqual(blank.saves, [undefined]);
});

test('IME composition prevents implicit Enter submission without blocking a later normal submit', () => {
    const editor = createEditor();
    editor.change('日本語');
    const input = editor.input(editor.render());
    let prevented = 0;
    input.props.onCompositionStart();
    input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault: () => { prevented += 1; } });
    editor.submit();
    assert.equal(prevented, 1);
    assert.deepEqual(editor.saves, []);
    input.props.onCompositionEnd();
    input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: () => assert.fail('normal Enter uses native submit') });
    editor.submit();
    assert.deepEqual(editor.saves, ['日本語']);
});

test('a failed synchronous update keeps the draft open and allows retry', () => {
    let attempts = 0;
    const editor = createEditor({ onSave: () => { attempts += 1; if (attempts === 1) throw new Error('Fixture failure'); } });
    editor.change('Keep draft');
    editor.submit();
    assert.equal(editor.closes, 0);
    assert.match(editor.input(editor.render()).props.error, /Could not update/);
    assert.equal(editor.input(editor.render()).props.value, 'Keep draft');
    editor.submit();
    assert.equal(attempts, 2);
    assert.equal(editor.closes, 1);
});

test('closed dialogs unmount their editor and optional actions are caller-owned', () => {
    const action = React.createElement('button', { type: 'button', 'data-action': 'move' }, 'Move');
    const editor = createEditor({ actions: action });
    assert.ok(elements(editor.render()).some(node => node.props['data-action'] === 'move'));
    assert.equal(editor.render({ isOpen: false }), null);
    assert.deepEqual(editor.saves, []);
});
