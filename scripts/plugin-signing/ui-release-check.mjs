import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ui = path.resolve(root, '..', 'npm-packages', 'plugin-ui');
for (const args of [
  [path.join(ui, 'tests/pluginUiPackage.test.mjs')],
  [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(ui, 'tsconfig.test.json')],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Plugin UI automatic release checks passed; beta only, not stable promotion.');
