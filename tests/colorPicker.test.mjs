import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, colorFieldPoint } from '../.tmp-agent-tests/src/components/ui/colorPickerMath.js';
import { ColorPicker } from '../.tmp-agent-tests/src/components/ui/ColorPicker.js';

test('picker accepts only opaque hex, normalizes RGB and rejects CSS/alpha/URLs', () => {
    for (const color of ['red', '#fff', '#112233ff', 'rgba(1,2,3,0.5)', 'url(file:///secret)', 'var(--color)']) assert.equal(hexToRgb(color), null);
    assert.deepEqual(hexToRgb('#AbCdEf'), { r: 171, g: 205, b: 239 });
    assert.equal(rgbToHex({ r: 171, g: 205, b: 239 }), '#abcdef');
    assert.equal(rgbToHex({ r: -1, g: 255.6, b: 0 }), '#00ff00');
});

test('RGB/HSV roundtrip covers grayscale, primaries and bounded representative colors', () => {
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
        assert.deepEqual(hsvToRgb(rgbToHsv({ r, g, b })), { r, g, b });
    }
    assert.deepEqual(rgbToHsv({ r: 0, g: 0, b: 0 }, 275), { h: 275, s: 0, v: 0 });
    assert.equal(rgbToHsv({ r: 128, g: 128, b: 128 }, 200).h, 200);
    assert.deepEqual(hsvToRgb({ h: 360, s: 100, v: 100 }), { r: 255, g: 0, b: 0 });
});

test('captured color-field movement is clamped to the measured bounds, including zero-size guards', () => {
    const bounds = { left: 20, top: 10, width: 200, height: 100 };
    assert.deepEqual(colorFieldPoint(120, 60, bounds), { s: 50, v: 50 });
    assert.deepEqual(colorFieldPoint(-100, -100, bounds), { s: 0, v: 100 });
    assert.deepEqual(colorFieldPoint(500, 500, bounds), { s: 100, v: 0 });
    assert.deepEqual(colorFieldPoint(20, 10, { ...bounds, width: 0, height: 0 }), { s: 0, v: 100 });
});

test('reusable picker stays a labeled native button when closed and has no native color dialog or persistence', () => {
    let calls = 0;
    const html = renderToStaticMarkup(createElement(ColorPicker, { label: 'Background', value: '#123456', onChange: () => calls++ }));
    assert.match(html, /aria-label="Edit Background color"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /type="color"|role="dialog"/);
    assert.equal(calls, 0);
    assert.match(renderToStaticMarkup(createElement(ColorPicker, { label: 'Text', value: '', disabled: true, onChange() {} })), /disabled=""/);
});

test('hue track has an isolated full spectrum with both browser engines and forced-color recovery', () => {
    const css = readFileSync(new URL('../src/theme/colorPicker.css', import.meta.url), 'utf8');
    assert.equal((css.match(/linear-gradient\(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00\)/g) ?? []).length, 2);
    assert.match(css, /::-webkit-slider-runnable-track/);
    assert.match(css, /::-moz-range-track/);
    assert.match(css, /forced-colors: active/);
    assert.match(css, /appearance: auto/);
});
