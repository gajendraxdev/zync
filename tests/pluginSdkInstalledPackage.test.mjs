import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Verify Zync's pinned SDK tarball, independently of a sibling source checkout. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = path.dirname(fileURLToPath(import.meta.resolve('@zync-sh/plugin-sdk')));
const app = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sdk = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));

assert.equal(sdk.name, '@zync-sh/plugin-sdk');
assert.equal(sdk.version, app.devDependencies[sdk.name]);
for (const file of ['LICENSE', 'index.js', 'validate.js', 'terminal.js', 'signing.js', 'bin/zync-plugin.mjs', 'bin/keygen.mjs', 'bin/pem-key.mjs']) {
  assert.ok(fs.statSync(path.join(sdkRoot, file)).isFile(), file);
}
console.log(`Pinned SDK ${sdk.version} package contents passed.`);
