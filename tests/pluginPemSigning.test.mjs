import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { generateKeys, readHiddenPassphrase } from '../packages/plugin-sdk/bin/keygen.mjs';
import { signPluginDirectory, verifySignedPlugin } from '../packages/plugin-sdk/signing.js';
import { readPemKey } from '../packages/plugin-sdk/bin/pem-key.mjs';
import { buildSignedRegistry, verifySignedRegistry } from '../scripts/plugin-signing/registry-signing.mjs';

// Prompt regressions: previously resumed stdin kept the CLI running after Enter.
for (const canceled of [false, true]) {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  input.resume();
  const pending = readHiddenPassphrase('test: ', input, { write() {} });
  input.emit('keypress', canceled ? '\x03' : '\r', canceled ? { ctrl: true, name: 'c' } : { name: 'return' });
  if (canceled) await assert.rejects(pending, /canceled/);
  else assert.equal(await pending, '');
  assert.equal(input.isPaused(), true);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('keypress'), 0);
  input.destroy();
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zync-pem-signing-test-'));
try {
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ manifestVersion: 2, publisher: 'dev.example', id: 'dev.example.pem', version: '1.0.0', name: 'PEM test' }));
  fs.writeFileSync(path.join(source, 'worker.js'), 'void 0;');
  const gitOpenSsl = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
  const executable = fs.existsSync(gitOpenSsl) ? gitOpenSsl : 'openssl';
  const opensslPresent = !spawnSync(executable, ['version']).error;
  for (const encrypted of [false, true]) {
    const passphrase = encrypted ? 'test-fixture-password-only' : '';
    const directory = path.join(root, encrypted ? 'encrypted' : 'plain');
    // Fixture fallback keeps release tests runnable on hosts without OpenSSL.
    let keys;
    if (opensslPresent) keys = generateKeys(['--out', directory, '--openssl', executable], spawnSync, passphrase);
    else {
      fs.mkdirSync(directory);
      const pair = generateKeyPairSync('ed25519');
      keys = { privatePath: path.join(directory, 'private.pem'), publicPath: path.join(directory, 'public.pem') };
      fs.writeFileSync(keys.privatePath, pair.privateKey.export({ format: 'pem', type: 'pkcs8', ...(encrypted ? { cipher: 'aes-256-cbc', passphrase } : {}) }));
      fs.writeFileSync(keys.publicPath, pair.publicKey.export({ format: 'pem', type: 'spki' }));
    }
    const output = path.join(root, encrypted ? 'signed-encrypted' : 'signed-plain');
    const result = signPluginDirectory(source, keys.privatePath, output, Date.now(), { passphrase });
    assert.equal(verifySignedPlugin(output).keyId, result.keyId);
    assert.equal(readPemKey(fs.readFileSync(keys.publicPath, 'utf8'), { requirePrivate: false }).keyId, result.keyId);
    assert.throws(() => signPluginDirectory(source, keys.publicPath, path.join(root, 'bad-public')), /private key/);
    if (encrypted) assert.throws(() => signPluginDirectory(source, keys.privatePath, path.join(root, 'wrong-passphrase'), Date.now(), { passphrase: 'wrong' }), /passphrase/);
    const cli = spawnSync(process.execPath, ['packages/plugin-sdk/bin/zync-plugin.mjs', 'verify', '--source', output], { encoding: 'utf8', timeout: 5000 });
    assert.equal(cli.status, 0, cli.stderr);
    const now = Date.now();
    const registry = path.join(root, encrypted ? 'registry-encrypted.json' : 'registry-plain.json');
    buildSignedRegistry({ releases: [{ packagePath: output, downloadUrl: 'https://example.test/plugin.zip', publisherVerified: false }], keyPath: keys.privatePath, passphrase, outputPath: registry, version: 1, issuedAtMs: now, expiresAtMs: now + 86400000 });
    assert.equal(verifySignedRegistry(registry, keys.publicPath, now).version, 1);
    fs.writeFileSync(path.join(output, 'worker.js'), 'tampered');
    assert.throws(() => verifySignedPlugin(output), /integrity/);
  }
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => readPemKey(rsa), /Ed25519/);
  console.log('PEM signing, registry verification, wrong-key rejection and prompt-exit regression checks passed.');
} finally {
  // Only disposable fixture keys were created in this test-owned temporary directory.
  fs.rmSync(root, { recursive: true, force: true });
}
