import fs from 'node:fs';
import { createPrivateKey, createPublicKey, createHash } from 'node:crypto';

export function readKeyText(keyPath) {
  const stat = fs.lstatSync(keyPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) {
    throw new Error('Signing key must be a regular file no larger than 512 KiB.');
  }
  return fs.readFileSync(keyPath, 'utf8');
}

export function readPemKey(text, { requirePrivate = true, passphrase } = {}) {
  if (!text.trimStart().startsWith('-----BEGIN ')) throw new Error('Expected a PEM key.');
  const isPrivate = /^-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/m.test(text);
  if (requirePrivate && !isPrivate) throw new Error('Signing requires a private key, not a public key.');
  let keyObject;
  try {
    keyObject = isPrivate
      ? createPrivateKey({ key: text, format: 'pem', ...(passphrase === undefined ? {} : { passphrase }) })
      : createPublicKey({ key: text, format: 'pem' });
  } catch {
    throw new Error('Cannot read PEM key. Check its format and passphrase.');
  }
  if (keyObject.asymmetricKeyType !== 'ed25519') throw new Error('Only Ed25519 signing keys are supported.');
  const publicObject = isPrivate ? createPublicKey(keyObject) : keyObject;
  const publicBytes = Buffer.from(publicObject.export({ format: 'jwk' }).x, 'base64url');
  return {
    keyObject,
    publicKey: publicBytes.toString('base64'),
    keyId: `sha256:${createHash('sha256').update(publicBytes).digest('hex')}`,
  };
}
