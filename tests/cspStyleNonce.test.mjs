import assert from 'node:assert/strict';

import {
  applyCspStyleNonce,
  getCspStyleNonce,
} from '../.tmp-agent-tests/src/lib/cspStyleNonce.js';

const root = {
  querySelector(selector) {
    assert.equal(selector, 'head style[nonce]');
    return { nonce: ' release-style-nonce ' };
  },
};
const style = { nonce: '' };

assert.equal(getCspStyleNonce(root), 'release-style-nonce');
applyCspStyleNonce(style, root);
assert.equal(style.nonce, 'release-style-nonce');
assert.equal(getCspStyleNonce({ querySelector: () => null }), undefined);

console.log('CSP style nonce helpers test passed.');
