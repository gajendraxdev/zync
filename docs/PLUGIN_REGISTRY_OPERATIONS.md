# Plugin Registry Operations

This runbook covers the production trust root for Zync's signed plugin registry. The root is a release authority, not a desktop application secret. Desktop builds receive public keys only. Registry operators may sign locally or use protected CI signing.

## Marketplace root custody and recovery

- Keep root private keys out of repositories, registry files, artifacts, chat, logs, and issue trackers. For automated publication, a protected GitHub Actions environment secret is an approved custody model. Never expose it to pull-request jobs or unrelated application build jobs.
- Keep two encrypted backups on separate media and in separate physical locations. Record the key id and public key in the release log.
- Independent review is recommended. A solo maintainer may operate signing, publication, and recovery with a recorded self-review. Automated signing may run on reviewed main-branch input changes without a manual approval per run; restrict environment deployment to main and protect source/configuration changes.
- Periodically test a backup on a disposable machine, verify a known registry fixture, record the result, and securely erase the restored copy.
- Losing every private-key copy means the current desktop trust root cannot publish new metadata. It does not justify bypassing signature checks.

## Publisher key custody and automated releases

Plugin publishers choose how they generate, store and use their own signing keys. Local signing, protected CI secrets, hardware-backed keys and external signing services are supported operating models; Zync does not require publisher keys to remain offline or prohibit publisher-controlled CI signing. Publisher private keys must never be included in plugin packages, committed to source, logged, or submitted to the marketplace. Marketplace operators receive public keys, fingerprints and signed artifacts, not publisher private keys.

For CI signing, recommended safeguards are protected release branches/tags, approval-gated environments, least-privilege workflow permissions, restricted access to secrets, reviewed/pinned build dependencies and actions, and temporary key files that are removed after signing. Keep PR validation and untrusted plugin code separate from jobs that receive signing secrets. A solo maintainer may use self-approval as an intentional release checkpoint; it is not independent review. Passphrase encryption is the publisher's choice and does not protect against a compromised signing job that receives both the key and its passphrase.

The interactive operator CLI cannot prompt in CI: it requires an unencrypted key stored in a protected secret for unattended signing. The Rust registry publication pipeline likewise requires an unencrypted root key. This is not a blanket publisher restriction: PM2's dedicated release pipeline also supports an encrypted publisher key with a separate passphrase secret.

Before marketplace publication, validate the signature, package integrity, approved publisher/key binding, manifest, compatibility, permissions and package limits, and perform the applicable release review. A valid signature establishes provenance and integrity, not benign behavior. Revoke compromised publisher keys or releases through higher, cumulatively revoked registry metadata. Publisher CI automation does not waive the separate root-custody and registry-publication requirements in this runbook.

## Standard OpenSSL publisher key generation

The SDK's `zync-sdk keygen` command wraps the standard OpenSSL CLI. See the [plugin SDK README](https://github.com/zync-sh/plugin-sdk/blob/main/README.md) for usage. It generates publisher keys only, not registry roots.

Keep private PEM files and passphrases private; distribute only public PEM files. The operator signing CLI accepts Ed25519 PEM keys as well as existing JSON keys. Encrypted private PEM keys prompt for a passphrase; registry verification can use the public PEM file without a passphrase. Keep publisher and root keys separate: PEM itself has no publisher or purpose label. Desktop builds require the raw 32-byte public key encoded as base64, not PEM text. Protected registry-release CI signing and documented solo-maintainer operation are approved root custody models.

## Publishing checklist

1. Build signed plugin packages and verify each package locally.
2. Use a registry version greater than every version previously published. Never reuse a version, including after a failed upload.
   Stable and beta releases share this registry version counter and trust root. Give beta releases prerelease semantic versions and mark their descriptor entries with `"channel": "beta"`; normal releases default to stable. Do not use a Zync build channel to select plugin releases.
3. Include every cumulative revocation. Clients permanently retain accepted revocations. Production metadata must expire after seven days and refresh daily through registry CI. Expiry bounds stale-index acceptance but does not guarantee immediate delivery of revocations. Compatible clients still understand legacy `expiresAtMs: 0` metadata; raise the baked-in minimum registry version to the first expiring publication when shipping the next desktop release so fresh clients reject older non-expiring indexes.
4. Build `registry.json` locally or in the protected registry-release pipeline, then independently verify it against configured public roots before publication. Zero-expiry metadata is supported for historical verification only. Production metadata must expire within seven days of issuance.
5. Upload to a staging object, download it again, and verify the downloaded bytes before atomically promoting it to the HTTPS registry URL.
6. Confirm the endpoint does not redirect away from HTTPS and serves no more than 2 MiB.
7. Test a release build against the published metadata before announcing the registry version.
8. Archive the signed registry, input release descriptor, version, expiry, hashes, signer key id, reviewer names, and publication time. Do not archive the private key with release artifacts.

Before promoting a staged object, run the same live check used by release CI:

```powershell
npm run plugin:registry-check -- --url $env:ZYNC_PLUGIN_STAGING_REGISTRY_URL --root-keys $env:ZYNC_PLUGIN_STAGING_REGISTRY_ROOT_KEYS --minimum-version 1 --min-valid-for-hours 24
```

The check follows at most three HTTPS-only redirects, reads at most 2 MiB, verifies the root signature against the complete rotation bundle, enforces a version floor, rejects non-expiring metadata or validity periods longer than seven days, and checks the requested remaining validity window. General signature verification retains historical zero-expiry compatibility, but the release gate does not. It never needs the root private key.

## Staging release gate

Create a protected GitHub environment named `plugin-staging` with these public configuration values as environment variables (secrets are also accepted when repository policy requires them):

- `ZYNC_PLUGIN_STAGING_REGISTRY_URL`;
- `ZYNC_PLUGIN_STAGING_REGISTRY_ROOT_KEYS`.

Run **Plugin registry staging** manually with the minimum registry version being promoted. The workflow validates the live endpoint, signing tools, native trust rules, and frontend production build. After it passes, manually use a desktop build pointed at staging to install one release, reject one permission review, accept it on a second attempt, exercise its command and pane, and verify rollback or revocation with a higher registry version. Record the tested registry version and package digest in the release log.

The normal **Release** workflow separately checks the production endpoint before it creates a draft release. Configure `ZYNC_PLUGIN_REGISTRY_MIN_VERSION` whenever production must reject an older published registry, and set `ZYNC_PLUGIN_REGISTRY_REQUIRED=true` when every release must include the trusted marketplace. URL and roots must either both be absent (an intentionally marketplace-disabled build) or both be configured. Once required, missing, wrongly signed, or unreachable metadata blocks release. Metadata must expire within seven days of issuance and have sufficient remaining validity; signed zero-expiry metadata blocks release.

Marketplace updates cannot downgrade an installed plugin or replace an existing semantic version with different bytes. Use Zync's retained-version rollback action for recovery.

## Planned root rotation

Zync accepts a comma-separated public-key bundle from `ZYNC_PLUGIN_REGISTRY_ROOT_KEYS`. Rotation is deliberately staged so old and new desktop versions remain usable.

1. Generate the new root offline and verify its backups.
2. Ship a desktop release whose trust bundle contains `oldPublicKey,newPublicKey`. Keep publishing with the old root while that release rolls out.
3. After the overlap release reaches the required adoption threshold, publish the next higher registry version signed by the new root.
4. Keep publishing refreshed, unexpired old-root metadata at the URL already baked into old clients. The overlap desktop release must use a new registry URL before that new URL begins serving metadata signed only by the new root.
5. Ship a later desktop release containing only `newPublicKey`.
6. Retire the old private key with a witnessed destruction record after the compatibility period.

Do not replace the CI public key and registry signature in one uncoordinated step. Clients that never received the overlap release will reject the new root, as intended.

## Suspected compromise

1. Stop marketplace publication and preserve logs and signed artifacts.
2. Determine whether the root key, a publisher key, or one exact plugin release is affected.
3. For a publisher key or release, publish a higher registry version with the matching cumulative revocation, signed by an uncompromised root.
4. For a root compromise, do not trust metadata signed after the suspected compromise time. Start the incident rotation path and ship a desktop trust update through the normal signed application release channel.
5. Notify users with affected plugin ids, versions, key ids, dates, and containment steps. Do not claim that package signatures prove plugin safety.
6. Complete a post-incident review before resuming publication.

## Release configuration

GitHub Actions needs:

- `ZYNC_PLUGIN_REGISTRY_URL`: the production HTTPS metadata URL;
- `ZYNC_PLUGIN_REGISTRY_ROOT_KEYS`: one public Ed25519 key, or `old,new` during rotation.

GitHub Actions also accepts the repository variables `ZYNC_PLUGIN_REGISTRY_MIN_VERSION` as the production version floor and `ZYNC_PLUGIN_REGISTRY_REQUIRED=true` to prohibit marketplace-disabled builds. The release check requires a configured registry to remain valid for at least 24 hours.

`ZYNC_PLUGIN_REGISTRY_ROOT_KEY` is accepted only as a compatibility fallback. A private registry root may be stored in the protected registry repository's `registry-release` environment secret, not in the Zync desktop release repository. Publisher-controlled workflows may separately store publisher signing keys in protected CI secrets.
