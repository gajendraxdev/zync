export {};
const assertModule = 'node:assert/strict';
const { default: assert } = await import(assertModule);
import { sshPrivateKeySecretValues, vaultItemToCredentialEnvelope } from '../src/vault/credentialTypes.js';
import type { VaultItem } from '../src/vault/ipc.js';

const item: VaultItem = { id: 'fixture-item', logicalId: 'fixture-key', kind: 'ssh-private-key',
  label: 'Fixture key', secretFingerprint: 'fixture-fingerprint', revision: 2,
  createdAt: 10, updatedAt: 20, schemaVersion: 2, secretFieldCount: 3,
  hasPassphraseField: true, hasSshCertificateField: true };
const envelope = vaultItemToCredentialEnvelope(item);
assert.deepEqual(envelope.fields.map(field => field.name), ['privateKey', 'passphrase', 'sshCertificate']);
assert.deepEqual(envelope.fields[2], { name: 'sshCertificate', label: 'SSH user certificate',
  secret: true, required: false, format: 'certificate', valueRef: 'secret:sshCertificate' });
assert.ok(envelope.fields.every(field => field.value === undefined));
assert.equal(vaultItemToCredentialEnvelope({ ...item, hasSshCertificateField: undefined }).fields.length, 2);
assert.equal(vaultItemToCredentialEnvelope({ ...item, kind: 'ssh-password' }).fields.length, 1);
assert.deepEqual(sshPrivateKeySecretValues('key', ' passphrase ', ' certificate\n'),
  { privateKey: 'key', passphrase: ' passphrase ', sshCertificate: 'certificate' });
assert.deepEqual(sshPrivateKeySecretValues('key', '   ', ''), { privateKey: 'key', passphrase: '   ' });
assert.deepEqual(sshPrivateKeySecretValues('key', '', '  '), { privateKey: 'key' });
console.log('Vault SSH certificate metadata regressions passed');
