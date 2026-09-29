import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { externalPaneAssetsMinZyncVersion, validatePackageDirectory } from '../packages/plugin-sdk/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(root, 'packages', 'plugin-sdk', 'templates', 'basic');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'zync-plugin-starter-'));
const output = path.join(project, 'dist');
let preview;
try {
  fs.cpSync(template, project, { recursive: true });
  const link = path.join(project, 'node_modules', '@zync-sh', 'plugin-sdk');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(path.join(root, 'packages', 'plugin-sdk'), link, process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(project, 'src', 'ui', 'assets'));
  fs.writeFileSync(path.join(project, 'src', 'ui', 'assets', 'extra.css'), 'p{}');
  const build = spawnSync(process.execPath, [path.join(project, 'scripts', 'build.mjs')], {
    cwd: project,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stderr);
  const result = validatePackageDirectory(output, { zyncVersion: externalPaneAssetsMinZyncVersion });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(validatePackageDirectory(output, { zyncVersion: '2.33.7' }).valid, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8')).id, 'dev.example.starter');
  const html = fs.readFileSync(path.join(output, 'ui', 'index.html'), 'utf8');
  assert.match(html, /Ask the Worker/);
  assert.match(html, /href="\.\/pane\.css"/);
  assert.match(html, /src="\.\/pane\.js"/);
  assert.match(fs.readFileSync(path.join(output, 'ui', 'pane.js'), 'utf8'), /zync\.pane\.postMessage/);
  assert.match(fs.readFileSync(path.join(output, 'ui', 'pane.css'), 'utf8'), /color-scheme/);
  assert.equal(fs.readFileSync(path.join(output, 'ui', 'assets', 'extra.css'), 'utf8'), 'p{}');
  ({ startPreview: preview } = await import(pathToFileURL(path.join(project, 'scripts', 'preview.mjs')).href));
  const server = await preview(output);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${base}/ui/index.html`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(await page.text(), /__zync_preview_shim\.js/);
    assert.equal((await fetch(`${base}/ui/pane.css`)).status, 200);
    assert.equal((await fetch(`${base}/ui/pane.js`)).status, 200);
    assert.equal((await fetch(`${base}/manifest.json`)).status, 404);
    assert.equal((await fetch(`${base}/ui/pane.js`, { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
} finally {
  if (project.startsWith(os.tmpdir())) fs.rmSync(project, { recursive: true, force: true });
}

console.log('plugin SDK starter template: build and validate OK');
