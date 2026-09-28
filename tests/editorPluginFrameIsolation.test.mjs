import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.join(process.cwd(), 'src', 'components', 'EditorPluginFrame.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');

const iframeSandbox = source.match(/<iframe[\s\S]*?sandbox="([^"]+)"/i)?.[1];
assert.equal(iframeSandbox, 'allow-scripts');
assert.equal(iframeSandbox.includes('allow-same-origin'), false);
assert.match(source, /Content-Security-Policy/, 'editor frames must receive their own CSP');
assert.match(
  source,
  /connect-src asset: http:\/\/asset\.localhost/,
  'editor frames may fetch only package assets needed to create isolated workers',
);
assert.match(source, /worker-src blob:/, 'editor frames must allow blob-backed package workers');
assert.doesNotMatch(
  source.match(/Content-Security-Policy[^`]+/)?.[0] ?? '',
  /connect-src[^;]*https:/,
  'editor frames must not inherit the app network allowlist',
);
assert.match(source, /object-src 'none'/, 'editor frames must disable embedded objects');
assert.match(
  source,
  /if \(readyForDocRef\.current\)/,
  'duplicate ready messages must not restart the active editor document',
);
assert.match(
  source,
  /onLoad=\{\(\) => \{[\s\S]*?setIsReady\(false\);[\s\S]*?readyForDocRef\.current = false;[\s\S]*?currentDocIdRef\.current = null;[\s\S]*?zync:editor:bootstrap/,
  'each iframe document load must reset its handshake before requesting bootstrap',
);

console.log('Editor plugin iframe isolation test passed.');
