import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('src/components/layout/tabDock/suppressDropClick.ts', 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { suppressDropClick } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const events = new EventTarget();
const target = {
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
};
let closes = 0;
suppressDropClick(target);
events.addEventListener('click', () => { closes += 1; });
const releaseClick = new Event('click', { cancelable: true });
await new Promise(resolve => setTimeout(resolve, 10));
events.dispatchEvent(releaseClick);
assert.equal(releaseClick.defaultPrevented, true);
assert.equal(closes, 0, 'The drop click must not reach the new close button');
events.dispatchEvent(new Event('click'));
assert.equal(closes, 1, 'Ordinary clicks remain usable after the drop');

suppressDropClick(target);
events.dispatchEvent(new Event('pointerdown'));
events.dispatchEvent(new Event('click'));
assert.equal(closes, 2, 'No-click drops must not swallow the next interaction');

suppressDropClick(target);
const keyboardClick = new Event('click', { cancelable: true });
Object.defineProperty(keyboardClick, 'detail', { value: 0 });
events.dispatchEvent(keyboardClick);
assert.equal(closes, 3, 'Keyboard activation is not swallowed');

suppressDropClick(target);
suppressDropClick(target);
events.dispatchEvent(new Event('blur'));
events.dispatchEvent(new Event('click'));
assert.equal(closes, 4, 'Re-arming and losing focus clear the guard without leaking listeners');
console.log('Pane drop click suppression tests passed.');
