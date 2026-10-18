/** Bundled artwork is an additive, offline choice through the existing icon engine. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MATERIAL_ICON_ASSETS } from '../.tmp-agent-tests/src/lib/icons/materialIconAssets.js';
import { findIconTheme, iconThemeOptions, iconThemeRevision } from '../.tmp-agent-tests/src/lib/icons/iconTheme.js';
import { getIconID, resolveIconResource } from '../.tmp-agent-tests/src/lib/icons/icon-map.js';
import { fileTypeIconID, ensureThemedIcon, getThemedIconEntry, themedIconKey } from '../.tmp-agent-tests/src/lib/icons/themedIconSrc.js';

const directory = new URL('../src/assets/material-icons/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('../plugin-api/builtin-icon-themes.json', import.meta.url), 'utf8'));
const plugins = catalog.map(plugin => ({ ...plugin, enabled: true }));
const provider = plugins.find(plugin => plugin.manifest.iconTheme);
const definition = provider.manifest.iconTheme;
const MATERIAL_ICON_THEME_ID = provider.manifest.id;
const MATERIAL_ICON_THEME_VERSION = provider.manifest.version;
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
assert.equal(manifest.version, '5.18.0');
assert.equal(manifest.version, MATERIAL_ICON_THEME_VERSION);
assert.equal(manifest.license, 'MIT');
assert.equal(Object.keys(MATERIAL_ICON_ASSETS).length, 65);
assert.equal(manifest.assets.length, 65);
assert.equal((await readdir(directory)).filter(name=>name.endsWith('.svg')).length, 65);
assert.match(await readFile(new URL('LICENSE.txt', directory), 'utf8'), /MIT License/);
for (const asset of manifest.assets) {
  assert.match(asset.path, /^[a-z-]+\.svg$/);
  const source = await readFile(new URL(asset.path, directory), 'utf8');
  assert.equal(`sha256-${createHash('sha256').update(source.replace(/\r?\n$/, '')).digest('base64')}`, asset.integrity, asset.path);
  assert.match(source, /<svg\b/, asset.path);
  assert.doesNotMatch(source, /<(?:script|foreignObject|image|animate|animateMotion|animateTransform|set)\b|<!DOCTYPE\b|\bon\w+\s*=/i, asset.path);
  for (const reference of source.matchAll(/url\(([^)]*)\)/g)) assert.ok(reference[1].trim().replace(/['"]/g,'').startsWith('#'), 'Paint servers stay inside the SVG');
  for (const reference of source.matchAll(/(?:href|xlink:href)\s*=\s*['"]([^'"]+)['"]/g)) assert.ok(reference[1].startsWith('#'), 'SVG references stay local');
}

const fileCases = new Map([
  ['app.js', 'javascript'], ['app.TS', 'typescript'], ['app.ts', 'typescript'],
  ['app.tsx', 'react'], ['App.tsx', 'react'], ['app.jsx', 'react'],
  ['app.py', 'python'], ['main.py', 'python'], ['main.go', 'go'], ['lib.rs', 'rust'], ['main.rs', 'rust'],
  ['worker.c', 'c'], ['worker.cpp', 'cpp'], ['worker.h', 'cpp'], ['Main.java', 'java'], ['main.java', 'java'],
  ['index.html', 'html'], ['style.css', 'css'], ['main.swift', 'swift'], ['Main.kt', 'kotlin'], ['main.dart', 'dart'],
  ['App.vue', 'vue'], ['App.svelte', 'svelte'], ['schema.graphql', 'graphql'], ['schema.prisma', 'prisma'], ['Gemfile', 'ruby'],
  ['deploy.sh', 'console'], ['deploy.ps1', 'powershell'], ['.bashrc', 'console'], ['README.md', 'markdown'],
  ['app.json', 'json'], ['app.yaml', 'yaml'], ['app.toml', 'toml'], ['nginx.conf', 'settings'], ['.env', 'settings'],
  ['package.json', 'nodejs'], ['tsconfig.json', 'tsconfig'], ['Dockerfile', 'docker'], ['docker-compose.yml', 'docker'],
  ['cargo.toml', 'rust'], ['backup.tar.gz', 'zip'], ['app.log', 'log'], ['image.png', 'image'], ['drawing.svg', 'svg'],
  ['guide.pdf', 'pdf'], ['store.sqlite', 'database'], ['id_ed25519', 'key'], ['certificate.pem', 'key'], ['certificate.crt', 'certificate'],
  ['unknown.custom', 'file'], ['unknown.bin', 'file'], ['constructor', 'file'], ['__proto__', 'file'],
]);
const folderCases = new Map([
  ['src', 'folder-src'], ['Sources', 'folder-src'], ['components', 'folder-components'], ['docs', 'folder-docs'], ['DOCS', 'folder-docs'],
  ['config', 'folder-config'], ['scripts', 'folder-scripts'], ['node_modules', 'folder-node'], ['dist', 'folder-dist'],
  ['releases', 'folder-dist'], ['assets', 'folder-resource'], ['images', 'folder-images'], ['public', 'folder-public'],
  ['tests', 'folder-test'], ['.git', 'folder-git'], ['backups', 'folder-archive'], ['logs', 'folder-log'], ['server', 'folder-server'],
  ['unrecognized', 'folder'], [' name.png ', 'folder'], [' src ', 'folder'], ['src ', 'folder'], ['src/docs', 'folder'], ['../../bad', 'folder'],
]);

/** Exercise the production resolver and resource policy together, not a parallel preview renderer. */
function assertBundledIcon(name, folder, expected) {
  const id = fileTypeIconID(name, folder, MATERIAL_ICON_THEME_ID, definition);
  assert.equal(id, expected, name);
  const resource = resolveIconResource(id, MATERIAL_ICON_THEME_ID, provider.path, undefined, definition);
  assert.equal(resource.local, MATERIAL_ICON_ASSETS[expected], name);
  assert.equal(resource.remote, undefined, `${name}: bundled icons never need a remote resource`);
}
for (const [name, expected] of fileCases) assertBundledIcon(name, false, expected);
for (const [name, expected] of folderCases) assertBundledIcon(name, true, expected);
for (const name of ['constructor', '__proto__', 'toString', '<script>alert(1)</script>.unknown']) {
  assertBundledIcon(name, false, 'file');
  assertBundledIcon(name, true, 'folder');
}
assert.equal(fileTypeIconID('unknown-one',true,MATERIAL_ICON_THEME_ID,definition), fileTypeIconID('unknown-two',true,MATERIAL_ICON_THEME_ID,definition), 'Generic folders share one bounded cache ID');
assert.deepEqual(resolveIconResource('../../outside.svg', MATERIAL_ICON_THEME_ID, provider.path, undefined, definition), {});
assert.equal(fileTypeIconID('src',true,'user-plugin'), 'folder_type_src', 'Existing plugin IDs are unchanged');
assert.equal(getIconID('app.ts','vscode-icons'), 'file_type_typescript');
assert.deepEqual(resolveIconResource('file_type_typescript','lucide'), {});
assert.match(resolveIconResource('file_type_typescript','vscode-icons').remote, /vscode-icons/);

globalThis.window = { __TAURI_INTERNALS__: { convertFileSrc:path=>`asset://${path}` } };
assert.equal(resolveIconResource('folder_type_src','dev.example.legacy','/custom-pack','icons').local, 'asset:///custom-pack/icons/folder_type_src.svg', 'Legacy installed plugins remain supported');
const id = fileTypeIconID('app.ts',false,MATERIAL_ICON_THEME_ID,definition);
const key = themedIconKey(MATERIAL_ICON_THEME_ID,id,provider.manifest.id,provider.path,'',iconThemeRevision(provider));
ensureThemedIcon(key,id,MATERIAL_ICON_THEME_ID,provider.path,undefined,definition);
await new Promise(resolve=>setTimeout(resolve,0));
assert.deepEqual(getThemedIconEntry(key), {status:'ready',src:MATERIAL_ICON_ASSETS.typescript}, 'Bundled artwork uses the existing engine cache without IPC');
assert.equal(iconThemeOptions(plugins).length, 3);
assert.equal(iconThemeOptions(plugins)[0].id, 'vscode-icons');
assert.equal(findIconTheme(plugins, MATERIAL_ICON_THEME_ID), provider);
assert.ok((await readFile(new URL('../src/store/settingsSlice.ts',import.meta.url),'utf8')).includes("iconTheme: 'vscode-icons'"), 'The existing default and saved selectors are not migrated');
console.log('Bundled Material icon recognition, integrity, safety, cache and compatibility checks passed.');
