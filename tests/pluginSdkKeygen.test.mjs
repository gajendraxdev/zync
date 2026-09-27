import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeys, readHiddenPassphrase } from '../packages/plugin-sdk/bin/keygen.mjs';

await assert.rejects(readHiddenPassphrase('Key passphrase: ', { isTTY: false }), /Passphrase entry needs an interactive terminal/);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zync-sdk-keygen-test-'));
try {
  const calls = [];
  const fakeOpenSsl = (executable, args, options) => {
    calls.push({ executable, args, options });
    if (args.includes('-out')) fs.writeFileSync(args[args.indexOf('-out') + 1], 'test fixture only');
    return { status: 0 };
  };
  const output = path.join(temporary, 'publisher');
  const result = generateKeys(['--out', output, '--openssl', 'explicit-openssl'], fakeOpenSsl, 'fixture-password');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.executable === 'explicit-openssl' && call.options.shell === false));
  assert.equal(calls[1].options.input, 'fixture-password\n');
  assert.ok(!calls.some(call => call.args.includes('fixture-password')));
  assert.ok(calls[1].args.includes('ED25519'));
  assert.ok(calls[1].args.includes('-aes-256-cbc'));
  assert.ok(fs.existsSync(result.publicPath));
  const plainStart = calls.length;
  generateKeys(['--out', path.join(temporary, 'unencrypted')], fakeOpenSsl, '');
  assert.ok(!calls[plainStart + 1].args.includes('-aes-256-cbc'));
  assert.ok(!calls[plainStart + 1].args.includes('-pass'));
  assert.ok(!calls[plainStart + 2].args.includes('-passin'));
  assert.throws(() => generateKeys(['--out', output], fakeOpenSsl), /already exists/);
  assert.throws(() => generateKeys(['--out', output, '--passphrase', 'secret'], fakeOpenSsl), /Usage/);
  assert.throws(() => generateKeys([], fakeOpenSsl), /Missing --out/);
  const repository = path.join(temporary, 'repository');
  fs.mkdirSync(path.join(repository, '.git'), { recursive: true });
  assert.throws(() => generateKeys(['--out', path.join(repository, 'keys')], fakeOpenSsl), /outside Git/);
  let failedCalls = 0;
  const failedOutput = path.join(temporary, 'failed');
  assert.throws(() => generateKeys(['--out', failedOutput], () => ({ status: ++failedCalls === 1 ? 0 : 1 })), /OpenSSL failed/);
  assert.equal(failedCalls, 2, 'public-key export must not run after generation fails');
  const missingOutput = path.join(temporary, 'missing');
  assert.throws(() => generateKeys(['--out', missingOutput], () => ({ error: new Error('ENOENT') })), /Cannot run OpenSSL/);
  assert.ok(!fs.existsSync(missingOutput));
  console.log('SDK keygen: dispatch, encryption, overwrite guards, Git guards and failure handling passed');
} finally {
  // This directory is created above for test fixtures only; it never contains production keys.
  fs.rmSync(temporary, { recursive: true, force: true });
}
