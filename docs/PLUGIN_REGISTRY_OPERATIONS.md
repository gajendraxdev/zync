# Plugin Registry Operations

This runbook covers the production trust root for Zync's signed plugin registry. The private root key is an offline release authority, not an application secret. Desktop builds receive public keys only.

## Custody and recovery

- Generate the root key on an offline machine. Never copy the private key into this repository, GitHub Actions, the registry host, chat, logs, or issue trackers.
- Keep two encrypted backups on separate media and in separate physical locations. Record the key id and public key in the release log.
- Require two people for key recovery, registry signing, revocation publication, and destruction of retired key material.
- Every quarter, restore a backup on an offline disposable machine, verify a known registry fixture, record the result, and securely erase the restored copy.
- Losing every private-key copy means the current desktop trust root cannot publish new metadata. It does not justify bypassing signature checks.

## Publishing checklist

1. Build signed plugin packages and verify each package locally.
2. Use a registry version greater than every version previously published. Never reuse a version, including after a failed upload.
3. Set a short, intentional expiry and include every cumulative revocation. Clients permanently retain accepted revocations.
4. Build `registry.json` on the offline signing machine and run `npm run plugin:registry-verify` before transfer.
5. Upload to a staging object, download it again, and verify the downloaded bytes before atomically promoting it to the HTTPS registry URL.
6. Confirm the endpoint does not redirect away from HTTPS and serves no more than 2 MiB.
7. Test a release build against the published metadata before announcing the registry version.
8. Archive the signed registry, input release descriptor, version, expiry, hashes, signer key id, reviewer names, and publication time. Do not archive the private key with release artifacts.

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

`ZYNC_PLUGIN_REGISTRY_ROOT_KEY` is accepted only as a compatibility fallback. Private registry or publisher keys must never be configured as repository secrets.
