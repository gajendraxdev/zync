import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getTerminalDocument } from '../.tmp-agent-tests/src/lib/terminal/terminalDocument.js';

class HostDocument {
  constructor(nonce) { this.nonce = nonce; }
  querySelector(selector) {
    assert.equal(this instanceof HostDocument, true, 'native receiver is preserved');
    assert.equal(selector, 'head style[nonce]');
    return this.nonce ? { nonce: this.nonce } : null;
  }
  createElement(tagName, options) {
    assert.equal(this instanceof HostDocument, true);
    return { localName: tagName.toLowerCase(), nonce: '', options, ownerDocument: this, appendChild(child) { return child; } };
  }
  get defaultView() {
    assert.equal(this instanceof HostDocument, true);
    return 'host-window';
  }
}

const root = new HostDocument('release-nonce');
const originalCreateElement = root.createElement;
const adapter = getTerminalDocument(root);
assert.notEqual(adapter, root);
assert.equal(adapter instanceof HostDocument, true, 'xterm document instanceof check is preserved');
assert.equal(adapter.constructor, HostDocument);
assert.equal(adapter.defaultView, 'host-window');
assert.equal(getTerminalDocument(root), adapter, 'adapter is reused across terminals');
assert.equal(adapter.querySelector, adapter.querySelector, 'bound native methods are stable');
assert.equal(adapter.querySelector('head style[nonce]').nonce, 'release-nonce');
assert.equal(root.createElement, originalCreateElement, 'no global document patch');
assert.equal(root.createElement('style').nonce, '', 'unrelated host styles are not authorized');
assert.equal(adapter.createElement('STYLE').nonce, 'release-nonce');
assert.equal(adapter.createElement('div').nonce, '');
assert.equal(adapter.createElement('style').ownerDocument, root);
const viewportStyle = { nodeType: 1, localName: 'style', nonce: '' };
assert.equal(adapter.createElement('div').appendChild(viewportStyle), viewportStyle);
assert.equal(viewportStyle.nonce, 'release-nonce', 'viewport styles are authorized before insertion');
const unrelatedStyle = { nodeType: 1, localName: 'style', nonce: '' };
root.createElement('div').appendChild(unrelatedStyle);
assert.equal(unrelatedStyle.nonce, '', 'normal host elements retain native behavior');
const fragment = { nodeType: 11 };
assert.equal(adapter.createElement('div').appendChild(fragment), fragment);
assert.deepEqual(adapter.createElement('div', { is: 'custom-element' }).options, { is: 'custom-element' });
assert.equal(getTerminalDocument(new HostDocument('other-nonce')).createElement('style').nonce, 'other-nonce');
const dev = new HostDocument();
assert.equal(getTerminalDocument(dev), dev, 'development has no adapter overhead');

for (const file of ['src/components/terminal/useTerminalLifecycle.ts', 'src/components/plugins/PluginTerminalLayer.tsx']) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(source, /documentOverride: getTerminalDocument\(/, `${file} must opt into host terminal styling`);
}
console.log('Terminal document adapter tests passed.');
