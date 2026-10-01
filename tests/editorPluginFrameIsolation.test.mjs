import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.join(process.cwd(), 'src', 'components', 'EditorPluginFrame.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const nativeDocumentSource = fs.readFileSync(
  path.join(process.cwd(), 'src-tauri', 'src', 'plugins', 'pane_document.rs'),
  'utf8',
);

const iframeSandbox = source.match(/<iframe[\s\S]*?sandbox="([^"]+)"/i)?.[1];
assert.equal(iframeSandbox, 'allow-scripts');
assert.equal(iframeSandbox.includes('allow-same-origin'), false);
assert.match(
  source,
  /usePluginEditorDocument\(fullHtml, plugin\.manifest\.id, nativeEditorDocument\)/,
  'native editor frames must use the manifest-bound document route',
);
assert.doesNotMatch(
  source,
  /convertFileSrc|dist\/editor\.(?:css|js)/,
  'the host must not hardcode provider asset paths',
);
assert.match(source, /src=\{editorDocument\.native[\s\S]*?editorDocument\.state\.url/);
assert.match(source, /srcDoc=\{editorDocument\.native \? undefined : fullHtml\}/);
assert.match(source, /worker-src blob:/, 'browser fallback frames must allow blob-backed workers');
assert.match(source, /object-src 'none'/, 'browser fallback frames must disable embedded objects');
assert.match(
  nativeDocumentSource,
  /read_pane_asset\(app, binding, path, MAX_PACKAGE_FILE_BYTES\)/,
  'isolated documents must accept every asset size already allowed by package validation',
);
assert.doesNotMatch(
  nativeDocumentSource,
  /MAX_ASSET_BYTES/,
  'the document route must not impose a smaller duplicate limit on valid plugin assets',
);
assert.match(
  nativeDocumentSource,
  /pub\(crate\) async fn plugins_editor_document_register[\s\S]*?spawn_blocking[\s\S]*?editor_asset_binding/,
  'editor package scanning and digesting must run outside the synchronous Tauri command path',
);
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
assert.match(
  source,
  /event\.source === window\.parent && message\?\.type === 'zync:editor:bootstrap'[\s\S]*?emitReady\(\{ supports: supportedCapabilities \}\)/,
  'the host bridge must re-advertise readiness for providers that do not handle bootstrap themselves',
);

console.log('Editor plugin iframe isolation test passed.');
