#!/usr/bin/env node
import { validatePackageDirectory } from '../validate.js';
import { generateKeys, promptPassphrase, readHiddenPassphrase } from './keygen.mjs';
import { readKeyText } from './pem-key.mjs';
import { signPluginDirectory, verifySignedPlugin } from '../signing.js';

const [command, directory, ...extra] = process.argv.slice(2);
const withVersion = extra.length === 2 && extra[0] === '--zync-version';
if (command === 'keygen') {
  try {
    let passphrase = await promptPassphrase();
    try { generateKeys(process.argv.slice(3), undefined, passphrase); }
    finally { passphrase = ''; }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === 'sign' || command === 'verify') {
  let passphrase;
  try {
    const allowed = command === 'sign' ? ['--source', '--key', '--out'] : ['--source'];
    const args = process.argv.slice(3);
    const options = new Map();
    for (let index = 0; index < args.length; index += 2) {
      if (!allowed.includes(args[index]) || !args[index + 1] || options.has(args[index])) throw new Error(`Invalid ${command} options.`);
      options.set(args[index], args[index + 1]);
    }
    for (const name of allowed) if (!options.has(name)) throw new Error(`Missing ${name}.`);
    if (command === 'sign') {
      if (readKeyText(options.get('--key')).includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
        passphrase = await readHiddenPassphrase('Key passphrase: ');
      }
      const result = signPluginDirectory(options.get('--source'), options.get('--key'), options.get('--out'), Date.now(), { passphrase });
      verifySignedPlugin(result.outputPath);
      console.log(`Signed and verified ${result.pluginId}: ${result.outputPath}`);
      console.log(`Publisher key fingerprint: ${result.keyId}`);
    } else {
      const result = verifySignedPlugin(options.get('--source'));
      console.log(`Valid signature: ${result.pluginId} (${result.keyId})`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally { passphrase = undefined; }
} else if (command !== 'validate' || !directory || (extra.length && !withVersion)) {
  console.error('Usage: zync-plugin validate <plugin-directory> [--zync-version <version>]');
  console.error('       zync-sdk keygen --out <NEW directory outside Git> [--openssl <executable>]');
  console.error('       zync-sdk sign --source <built plugin> --key <private key.pem> --out <new signed directory>');
  console.error('       zync-sdk verify --source <signed directory>');
  process.exitCode = 2;
} else {
  try {
    const result = validatePackageDirectory(directory, withVersion ? { zyncVersion: extra[1] } : {});
    for (const issue of result.issues) {
      const stream = issue.severity === 'error' ? process.stderr : process.stdout;
      stream.write(`${issue.severity}: ${issue.path}: ${issue.message}\n`);
    }
    if (result.valid) console.log('Plugin preflight passed. Zync will validate again at install time.');
    else process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
