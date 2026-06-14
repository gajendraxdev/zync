import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNC_PASSPHRASE_MIN_LENGTH,
  canSubmitSyncSetup,
  formatSyncCollectionIdLabel,
  formatSyncCollectionSetupError,
  getSyncPassphraseLabel,
  validateSyncSetupPassphrase,
} from '../.tmp-agent-tests/src/vault/syncPassphrase.js';

test('getSyncPassphraseLabel switches by policy mode', () => {
  assert.equal(getSyncPassphraseLabel('local-passphrase'), 'Local Vault passphrase');
  assert.equal(getSyncPassphraseLabel('custom-passphrase'), 'Google encryption passphrase');
});

test('validateSyncSetupPassphrase requires one field for local policy', () => {
  const valid = validateSyncSetupPassphrase({
    mode: 'local-passphrase',
    passphrase: 'a'.repeat(SYNC_PASSPHRASE_MIN_LENGTH),
    confirmPassphrase: '',
    hasLocalVaultConfigured: true,
  });
  assert.equal(valid, null);

  const mismatchIgnored = validateSyncSetupPassphrase({
    mode: 'local-passphrase',
    passphrase: 'a'.repeat(SYNC_PASSPHRASE_MIN_LENGTH),
    confirmPassphrase: 'different-passphrase',
    hasLocalVaultConfigured: true,
  });
  assert.equal(mismatchIgnored, null);
});

test('validateSyncSetupPassphrase enforces confirm for custom policy', () => {
  const mismatch = validateSyncSetupPassphrase({
    mode: 'custom-passphrase',
    passphrase: 'a'.repeat(SYNC_PASSPHRASE_MIN_LENGTH),
    confirmPassphrase: 'b'.repeat(SYNC_PASSPHRASE_MIN_LENGTH),
    hasLocalVaultConfigured: true,
  });
  assert.equal(mismatch, 'Passphrases do not match.');

  const valid = validateSyncSetupPassphrase({
    mode: 'custom-passphrase',
    passphrase: 'a'.repeat(SYNC_PASSPHRASE_MIN_LENGTH),
    confirmPassphrase: 'a'.repeat(SYNC_PASSPHRASE_MIN_LENGTH),
    hasLocalVaultConfigured: true,
  });
  assert.equal(valid, null);
});

test('validateSyncSetupPassphrase trims whitespace before validation', () => {
  const padded = validateSyncSetupPassphrase({
    mode: 'local-passphrase',
    passphrase: `  ${'a'.repeat(SYNC_PASSPHRASE_MIN_LENGTH)}  `,
    confirmPassphrase: '',
    hasLocalVaultConfigured: true,
  });
  assert.equal(padded, null);

  const shortAfterTrim = validateSyncSetupPassphrase({
    mode: 'local-passphrase',
    passphrase: '   short   ',
    confirmPassphrase: '',
    hasLocalVaultConfigured: true,
  });
  assert.match(shortAfterTrim, /must be at least/);
});

test('canSubmitSyncSetup mirrors validation readiness', () => {
  assert.equal(canSubmitSyncSetup({
    mode: 'local-passphrase',
    passphrase: 'a'.repeat(SYNC_PASSPHRASE_MIN_LENGTH),
    confirmPassphrase: '',
    hasLocalVaultConfigured: true,
    isSubmitting: false,
  }), true);

  assert.equal(canSubmitSyncSetup({
    mode: 'local-passphrase',
    passphrase: 'a'.repeat(SYNC_PASSPHRASE_MIN_LENGTH),
    confirmPassphrase: '',
    hasLocalVaultConfigured: true,
    isSubmitting: true,
  }), false);
});

test('formatSyncCollectionIdLabel shortens long collection ids', () => {
  assert.equal(
    formatSyncCollectionIdLabel('123e4567-e89b-12d3-a456-426614174000'),
    '123e4567…4000',
  );
  assert.equal(formatSyncCollectionIdLabel('short-id'), 'short-id');
});

test('formatSyncCollectionSetupError maps known sync setup codes', () => {
  const mismatch = formatSyncCollectionSetupError({
    message: '[sync_collection_passphrase_mismatch] Local Vault passphrase did not unlock this vault.',
  });
  assert.equal(mismatch, 'Local Vault passphrase did not unlock this vault.');

  const uninitialized = formatSyncCollectionSetupError({
    message: '[vault_uninitialized] Initialize the local vault before setting up provider sync.',
  });
  assert.equal(uninitialized, 'Initialize the local vault before setting up provider sync.');
});