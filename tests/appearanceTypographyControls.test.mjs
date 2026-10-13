import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Children, createElement as h, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import rehypeRaw from 'rehype-raw';
import ts from 'typescript';
import { FontStackField } from '../.tmp-agent-tests/src/components/settings/common/FontStackField.js';
import { Button } from '../.tmp-agent-tests/src/components/ui/Button.js';
import { Input } from '../.tmp-agent-tests/src/components/ui/Input.js';
import { Toolbar } from '../.tmp-agent-tests/src/components/ui/Toolbar.js';
import * as defaults from '../.tmp-agent-tests/src/components/settings/constants/defaults.js';

const require = createRequire(import.meta.url);

/** Exercise current presentation source without starting terminal services or the app store. */
function loadSource(path, boundaries) {
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, {
        module, exports: module.exports,
        require: (name) => Object.hasOwn(boundaries, name) ? boundaries[name] : require(name),
    });
    return module.exports;
}

const boundaries = {
    '../../../ui/Button': { Button },
    '../../../ui/Toolbar': { Toolbar },
    '../../../ui/Select': { Select: () => null },
    '../../common/Section': { Section: ({ children }) => h('section', null, children) },
    '../../common/Toggle': { Toggle: () => null },
    '../../constants/defaults': defaults,
    '../../common/FontStackField': { FontStackField },
    '../../../../lib/terminal/terminalTypography': {
        resolveTerminalFontWeightBold: () => { throw new Error('Unexpected terminal renderer access'); },
    },
};
const { AppearanceInterfaceTypographySection } = loadSource(
    'src/components/settings/tabs/appearance/AppearanceInterfaceTypographySection.tsx', boundaries,
);
const { TerminalTypographySection } = loadSource(
    'src/components/settings/tabs/terminal/TerminalTypographySection.tsx', boundaries,
);

const descendants = (node) => [node, ...(node.children ?? []).flatMap(descendants)];
const elementDescendants = (node) => isValidElement(node)
    ? [node, ...Children.toArray(node.props.children).flatMap(elementDescendants)]
    : [];
const fieldProps = {
    label: 'Custom font stack',
    value: "'Example', monospace",
    placeholder: 'Example font',
    onChange: () => assert.fail('render must not change the draft'),
    onApply: () => assert.fail('render must not save settings'),
};
const settings = { globalFontFamily: 'system-ui', terminal: { fontFamily: 'monospace', fontSize: 14 } };

test('font-stack editors associate labels and use a non-submit Apply action', () => {
    const html = renderToStaticMarkup(h('form', null,
        h(FontStackField, fieldProps),
        h(FontStackField, { ...fieldProps, label: 'Terminal font stack', monospace: true }),
    ));
    const tree = rehypeRaw()({ type: 'root', children: [{ type: 'raw', value: html }] });
    const nodes = descendants(tree);
    const labels = nodes.filter((node) => node.tagName === 'label');
    const inputs = nodes.filter((node) => node.tagName === 'input');
    const buttons = nodes.filter((node) => node.tagName === 'button');
    assert.equal(labels.length, 2);
    assert.equal(inputs.length, 2);
    assert.equal(buttons.length, 2);
    assert.equal(new Set(inputs.map((node) => node.properties.id)).size, 2);
    for (const [index, input] of inputs.entries()) {
        assert.equal(labels[index].properties.htmlFor[0], input.properties.id);
        assert.equal(input.properties.value, fieldProps.value);
        assert.equal(buttons[index].properties.type, 'button');
    }
    assert.equal(inputs[1].properties.className.includes('font-mono'), true);
});

test('font-stack editing delegates the unchanged draft and saves once for click or Enter', () => {
    const drafts = [];
    let applies = 0;
    const nodes = elementDescendants(FontStackField({
        ...fieldProps,
        onChange: (value) => drafts.push(value),
        onApply: () => { applies += 1; },
    }));
    const input = nodes.find((node) => node.type === Input);
    const apply = nodes.find((node) => node.type === Button);
    input.props.onChange({ target: { value: '  custom, sans-serif  ' } });
    assert.deepEqual(drafts, ['  custom, sans-serif  ']);
    assert.equal(applies, 0);
    apply.props.onClick();
    assert.equal(applies, 1);
    let prevented = 0;
    input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: () => { prevented += 1; } });
    assert.equal(applies, 2);
    assert.equal(prevented, 1, 'Enter must not also submit a surrounding form');
});

test('font-stack editors retain text-navigation keys and do not apply an IME composition', () => {
    let stopped = 0;
    const nodes = elementDescendants(FontStackField(fieldProps));
    const input = nodes.find((node) => node.type === Input);
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
        input.props.onKeyDown({ key, stopPropagation: () => { stopped += 1; } });
    }
    assert.equal(stopped, 4);
    input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true } });
    input.props.onKeyDown({ key: 'Tab' });
});

test('interface typography retains caller-owned apply, draft, reset and slider commit callbacks', () => {
    const callbacks = {
        onGlobalFontDraftChange: () => {},
        onApplyCustomFont: () => {},
        onGlobalFontFamilyChange: () => {},
        onDraftGlobalFontSizeChange: () => {},
        onCommitGlobalFontSize: () => {},
        onResetTypography: () => {},
    };
    const nodes = elementDescendants(AppearanceInterfaceTypographySection({
        settings, globalFontDraft: 'custom', draftGlobalFontSize: 14, ...callbacks,
    }));
    const field = nodes.find((node) => node.type === FontStackField);
    const reset = nodes.find((node) => node.type === Button);
    const slider = nodes.find((node) => node.type === 'input' && node.props.type === 'range');
    assert.equal(field.props.onChange, callbacks.onGlobalFontDraftChange);
    assert.equal(field.props.onApply, callbacks.onApplyCustomFont);
    assert.equal(reset.props.onClick, callbacks.onResetTypography);
    assert.equal(reset.props.type, 'button');
    assert.equal(slider.props.onPointerUp, callbacks.onCommitGlobalFontSize);
    assert.equal(slider.props.onKeyUp, callbacks.onCommitGlobalFontSize);
    assert.equal(slider.props.onBlur, callbacks.onCommitGlobalFontSize);
});

test('terminal typography applies only a trimmed nonempty font stack through its existing update callback', () => {
    const updates = [];
    for (const draft of ['   ', '  Custom Mono, monospace  ']) {
        const nodes = elementDescendants(TerminalTypographySection({
            settings,
            terminalFontDraft: draft,
            isWindows: false,
            onTerminalFontDraftChange: () => {},
            onUpdateTerminalSettings: (patch) => updates.push(patch),
        }));
        const field = nodes.find((node) => node.type === FontStackField);
        assert.equal(field.props.id, 'terminal-custom-font-stack-input');
        field.props.onApply();
        const reset = nodes.find((node) => node.type === Button);
        assert.equal(reset.props.type, 'button');
    }
    assert.equal(updates.length, 1);
    assert.deepEqual(Object.keys(updates[0]), ['fontFamily']);
    assert.equal(updates[0].fontFamily, 'Custom Mono, monospace');
});

test('interface font-size slider has an associated name, units and description', () => {
    const html = renderToStaticMarkup(h(AppearanceInterfaceTypographySection, {
        settings, globalFontDraft: 'custom', draftGlobalFontSize: 18,
    }));
    const tree = rehypeRaw()({ type: 'root', children: [{ type: 'raw', value: html }] });
    const nodes = descendants(tree);
    const slider = nodes.find((node) => node.tagName === 'input' && node.properties.type === 'range');
    const label = nodes.find((node) => node.tagName === 'label' && node.properties.htmlFor?.includes(slider.properties.id));
    assert.ok(label);
    assert.equal(label.children[0].value, 'Global Font Size');
    assert.equal(slider.properties.ariaValueText, '18 pixels');
    for (const id of slider.properties.ariaDescribedBy) {
        assert.ok(nodes.some((node) => node.properties?.id === id));
    }
});
