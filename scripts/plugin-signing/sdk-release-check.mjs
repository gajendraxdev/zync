import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sdk = path.dirname(fileURLToPath(import.meta.resolve('@zync-sh/plugin-sdk')));
const metadata = JSON.parse(fs.readFileSync(path.join(sdk, 'package.json'), 'utf8'));
if (metadata.private || !metadata.name || !metadata.version || !metadata.bin?.['zync-plugin']) {
  throw new Error('Plugin SDK package metadata is not publishable');
}

for (const args of [
  [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'tsconfig.agent-tests.json')],
  [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'tsconfig.plugin-sdk.json')],
  [path.join(root, 'tests', 'pluginSdkInstalledPackage.test.mjs')],
  [path.join(root, 'tests', 'pluginSdkValidator.test.mjs')],
  [path.join(root, 'tests', 'pluginTerminalIntegration.test.mjs')],
  [path.join(root, 'tests', 'pluginPemSigning.test.mjs')],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Pinned SDK ${metadata.version} host compatibility checks passed. Run the SDK repository's publish gate separately before releasing a new package.`);
