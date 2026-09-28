import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/plugins/pluginIconPath.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { pluginIconPath } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

assert.equal(pluginIconPath('C:\\plugins\\third-party', 'icons/custom.svg'), 'C:/plugins/third-party/icons/custom.svg');
assert.equal(pluginIconPath('/plugins/example/', 'logo.PNG'), '/plugins/example/logo.PNG');
assert.equal(pluginIconPath('C:/plugins/example', 'icons\\custom.webp'), 'C:/plugins/example/icons/custom.webp');
assert.equal(pluginIconPath('\\\\server\\plugins\\example', 'icon.svg'), '//server/plugins/example/icon.svg');

for (const icon of [undefined, '', '../icon.svg', 'icons/../../icon.svg', '/icon.svg', 'C:\\icon.svg', 'https://example.com/icon.svg', 'icons//icon.svg', './icon.svg', '%2e%2e/icon.svg', 'icon.svg?x=1', 'icon.svg#fragment', 'bad\0.svg', 'worker.js']) {
  assert.equal(pluginIconPath('C:/plugins/example', icon), null, `Rejected unsafe or unsupported icon: ${icon}`);
}
for (const root of [undefined, '', 'relative/plugins', 'C:/plugins/../example', '/plugins/./example']) {
  assert.equal(pluginIconPath(root, 'icon.svg'), null);
}

console.log('Plugin icon paths: nested assets supported; unsafe paths rejected.');
