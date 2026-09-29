import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paneAssetMimeTypes } from '@zync-sh/plugin-sdk/validate';
import manifest from '../manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
if (output === root || !output.startsWith(`${root}${path.sep}`)) {
  throw new Error('Build output must be a directory inside the plugin project');
}
fs.mkdirSync(path.join(output, 'ui'), { recursive: true });
fs.copyFileSync(path.join(root, 'src', 'worker.js'), path.join(output, 'worker.js'));
const allowedUiTypes = new Set(['.html', ...Object.keys(paneAssetMimeTypes)]);
fs.cpSync(path.join(root, 'src', 'ui'), path.join(output, 'ui'), {
  recursive: true,
  filter(source) {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new Error(`UI source must be a regular file or directory: ${source}`);
    }
    if (stat.isFile() && !allowedUiTypes.has(path.extname(source).toLowerCase())) {
      throw new Error(`Unsupported UI asset type: ${source}`);
    }
    return true;
  },
});
fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built plugin: ${output}`);
