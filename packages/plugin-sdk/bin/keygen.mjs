import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';

export function readHiddenPassphrase(label, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Passphrase entry needs an interactive terminal. Run it in PowerShell, Terminal or a terminal tab.'));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = Boolean(input.isRaw);
    emitKeypressEvents(input);
    function finish(error) {
      input.removeListener('keypress', onKey);
      input.setRawMode(wasRaw);
      // Release stdin so the CLI can exit naturally after the prompt.
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
      value = '';
    }
    function onKey(text, key = {}) {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(new Error('Key generation canceled.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    }
    output.write(label);
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.resume();
  });
}

export async function promptPassphrase() {
  let passphrase = await readHiddenPassphrase('Passphrase (Enter to skip encryption): ');
  if (!passphrase) return '';
  if (passphrase.length < 4 || passphrase.length > 1023) throw new Error('Passphrase must contain 4 to 1023 characters; use a long unique one.');
  const confirmation = await readHiddenPassphrase('Confirm passphrase: ');
  if (passphrase !== confirmation) { passphrase = ''; throw new Error('Passphrases do not match. No keys were generated.'); }
  return passphrase;
}

export function generateKeys(args, run = spawnSync, passphrase = '') {
  if (typeof passphrase !== 'string' || /[\r\n\x00]/.test(passphrase)) throw new Error('Invalid passphrase.');
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!['--out', '--openssl'].includes(name) || !args[index + 1] || options.has(name)) {
      throw new Error('Usage: zync-sdk keygen --out <NEW directory outside Git> [--openssl <executable>]');
    }
    options.set(name, args[index + 1]);
  }
  if (!options.has('--out')) throw new Error('Missing --out: choose a new directory on encrypted, non-synced storage outside Git.');
  const destination = path.resolve(options.get('--out'));
  if (fs.existsSync(destination)) throw new Error('Output directory already exists; no keys will be overwritten.');
  for (let ancestor = destination; ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(path.join(ancestor, '.git'))) throw new Error('Private keys must be stored outside Git repositories.');
    if (path.dirname(ancestor) === ancestor) break;
  }
  const gitOpenSsl = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
  const executable = options.get('--openssl')
    ?? (process.platform === 'win32' && fs.existsSync(gitOpenSsl) ? gitOpenSsl : 'openssl');
  function invoke(arguments_, withPassphrase = false) {
    const result = run(executable, arguments_, withPassphrase
      ? { stdio: ['pipe', 'inherit', 'inherit'], shell: false, input: `${passphrase}\n` }
      : { stdio: 'inherit', shell: false });
    if (result.error) throw new Error(`Cannot run OpenSSL: ${result.error.message}. Install it or supply --openssl.`);
    if (result.status !== 0) throw new Error('OpenSSL failed. Stop here; do not use partial output. Choose a new directory when retrying.');
  }
  invoke(['version']);
  // Exclusive directory creation also protects against a competing invocation.
  // The parent must already exist; do not reuse a concurrently created directory.
  fs.mkdirSync(destination, { mode: 0o700 });
  const privatePath = path.join(destination, 'publisher-private.pem');
  const publicPath = path.join(destination, 'publisher-public.pem');
  if (!passphrase) console.warn('Warning: private key is UNENCRYPTED. Anyone who copies it can sign as you.');
  invoke(['genpkey', '-algorithm', 'ED25519', ...(passphrase ? ['-aes-256-cbc', '-pass', 'stdin'] : []), '-out', privatePath], Boolean(passphrase));
  if (!fs.existsSync(privatePath) || fs.statSync(privatePath).size === 0) throw new Error('OpenSSL did not produce a private key.');
  fs.chmodSync(privatePath, 0o600);
  invoke(['pkey', '-in', privatePath, ...(passphrase ? ['-passin', 'stdin'] : []), '-pubout', '-out', publicPath], Boolean(passphrase));
  if (!fs.existsSync(publicPath) || fs.statSync(publicPath).size === 0) throw new Error('OpenSSL did not produce a public key.');
  console.log(`Created publisher key pair in ${destination}. Only publisher-public.pem may be shared.`);
  return { privatePath, publicPath };
}
