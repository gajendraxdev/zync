# Security Notes

**Last updated:** 2026-09-27
**Scope:** Vault, Google Drive sync, Public URLs (Beta), plugins, credential handling, anonymous usage, and operator guidance, including the Zync 2.33.0 release candidate.

---

## Summary

Zync’s core security surface is **encrypted local vaulting**, optional **remember-on-device unlock**, and **Google Drive–backed encrypted sync**. From v2.27.1, an optional **Public URLs (Beta)** feature adds a separate Zync account (GitHub/Google share login) and a localhost-only share agent that talks to Zync-operated API and relay hosts. Zync does not automatically send SSH sessions, vault secrets, or terminal content to those hosts. HTTP, WebSocket, and TCP bytes from the **user-selected shared loopback port** are proxied through the relay while the share is active. This document explains how those systems behave, what users and operators should know, and what remains out of scope.

---

## Security Capabilities

### Local Vault (encrypted at rest)

- Host credentials can be stored in an **encrypted local vault** instead of plaintext connection files.
- Vault crypto uses **Argon2id key derivation** and **AEAD** for record encryption (see [VAULT.md](./VAULT.md)).
- Vault unlock requires a user passphrase; a **recovery key** can be generated for passphrase loss scenarios.
- Plaintext host credentials can be **migrated into the vault** during normal workflows.

### Stable credential identity

- Hosts reference vault credentials via durable **`credentialId`** / `logicalId` instead of owning raw secrets directly.
- Stale `itemId` / missing `credentialId` paths include **self-healing relink and repair** on load.

### Credential revision history

- Rotated credentials keep **revision snapshots**; operators can review prior revisions and restore an older one from the Vault UI.
- Restore preserves stable `credentialId` identity so host references stay valid.

### Google Drive vault sync

- Vault backups and sync collections are stored in Google **`drive.appdata`** (hidden app folder, not user-visible Drive files).
- Sync collections use a **separate encryption passphrase** (local-vault-derived or custom).
- OAuth uses Google's installed/desktop app flow with scoped access to Drive app data and account email.

### Anonymous usage (optional)

When **Settings → General → Share anonymous usage** is on (default), the desktop app may POST to the Zync analytics API (`/api/v1/usage`). A random install id is stored on this device and sent in that request so the same install can be counted across days. The **payload** also has app version, OS, UTC day, and feature names you opened (Files, terminal, split, tunnels, vault, Public URLs, snippets, dashboard, plugins) with a use count. The payload does **not** include an IP address, hostnames, paths, commands, vault contents, or terminal output. Turn the setting off to stop sending. The queue stays local until a flush on open, close, or every 15 minutes.

### Plugins and granted capabilities (2.33.0)

- **Manifest v2 isolation.** Workers and pane frames have no direct host DOM, raw IPC, or unrestricted filesystem/network bridge. Native brokers check the current runtime, package identity, permission grant, and applicable scope. This does not make every approved capability harmless.
- **Remote commands are powerful.** Plugin API 2.1's `ssh.command.execute` grants command execution as the SSH account on the server bound to that pane. It is not a read-only PM2 permission or a remote OS sandbox. A granted plugin can receive command output, including sensitive server data. Arguments, time, output size, concurrency, and pane ownership are bounded; those limits do not prevent all remote side effects.
- **Host-owned consent.** Required access is reviewed during installation/update. For declared optional access, Allow records a package-bound grant; Deny cancels the action without persisting a rejection and the next attempt can ask again. Grants can be revoked in Settings -> Plugins. Revocation or pane rebind cancels brokered channels but cannot undo completed operations or guarantee that remote daemonized work stops.
- **Selected-file access and logs.** Local file operations use host-selected destinations and runtime-owned handles. Exported logs may contain secrets or personal data; choose a trusted destination. A plugin with separately granted network access may send permitted data to third-party services. Review its source and privacy practices.
- **Signed distribution.** Trusted marketplace metadata and package signatures establish publisher/package provenance, not a guarantee that plugin behavior is safe. Release compatibility, permission changes, revocation, retained-version rollback, and crash recovery remain host-controlled. Production trusted marketplace availability depends on valid registry configuration.
- **Registry freshness.** Production registry publication requires a bounded expiry (at most seven days), with daily automated refreshes. Expiry limits stale-index acceptance, not immediate revocation delivery. Compatible clients still accept historical signed zero-expiry metadata; the next desktop release must raise its baked-in minimum registry version to the first expiring publication to reject those older indexes on fresh installations. Retained version floors and cumulative revocations remain enforced. Protected CI root signing is supported; compromise of that job or its secret permits registry forgery and requires root recovery/rotation. Restrict signing deployment to main and protect changes to signing source, approvals, inputs, and workflows.
- **Legacy trust boundary.** Local and legacy plugins require Developer Mode, which defaults off. Their compatibility bridge is broader than Manifest v2's brokered API; do not describe legacy plugins as having the same isolation. Crash quarantine targets a failing plugin. App restarts no longer trigger blanket third-party-plugin safe mode; saved global safe-mode flags are cleared while per-plugin failure history is retained.
- **Shortcut messages are untrusted.** A focused iframe and matching binding do not prove a user keypress. The host permits only a restricted set of presentation/navigation requests; privileged actions stay host-controlled.

See [PLUGINS.md](./PLUGINS.md) for the implemented boundaries and remaining release gates, and [PLUGIN_REGISTRY_OPERATIONS.md](./PLUGIN_REGISTRY_OPERATIONS.md) for signing-key custody and staging procedures.

### Public URLs (Beta)

The Public URLs feature is **not** SSH port forwarding (`-L` / `-R` / `-D`). It is an optional SaaS surface: a Zync account, a desktop share agent, and Zync-operated API + HTTPS/WSS relay.

- **Separate OAuth clients.** Drive Sync login is not Public URLs sign-in. GitHub/Google used for Public URLs are share-account clients (email/profile), not `drive.appdata`.
- **Localhost-only agent.** The desktop agent proxies only to loopback targets (`127.0.0.1` / `localhost` / `::1`). Non-loopback hosts are refused.
- **Link access.** Anyone with the public HTTPS URL can reach that local port while the share is active, unless you set an optional share password. Treat the URL like a capability.
- **Lifetime.** A share stays up while the **share agent** is running on this device. Dropping an SSH session does not stop a Public URL (and vice versa). Stop or delete the share (or sign out) to end it.
- **Tokens.** Share access/refresh material is stored in the OS keyring. Sign out clears the local session.
- **Beta.** Quota is a hard cap (no free/pro copy in-app). Report issues with the in-app bug link after sign-in.

---

## Security Hardening

| Area | Behavior |
|------|----------|
| **Session unlock cache** | Optional OS keychain cache for vault session material; hardened restore and vault-auth edge cases |
| **Connect / test flows** | Vault-backed hosts prompt for unlock instead of silently failing or auto-connecting with missing secrets |
| **Tab open behavior** | Vault-backed connections defer auto-connect until explicit user reconnect |
| **Sync durability** | Atomic JSON writes with fsync on production sync/vault paths; improved restore convergence and Windows finalize handling |
| **Concurrent operations** | Guards against vault/sync state loss during overlapping provider and local operations |
| **Build-time secret filtering** | `build.rs` blocks most sensitive env keys from compile-time embedding; Drive `GOOGLE_CLIENT_SECRET` is explicitly allowlisted only for desktop OAuth compatibility |
| **Public URLs agent** | Share proxy refuses non-loopback targets; OAuth callback binds loopback only |

---

## Operator & User Guidance

### Passphrases and recovery

- Choose a **strong vault passphrase** (sync collection passphrases require at least 12 characters).
- **Store the recovery key offline** before relying on the vault for production hosts.
- If you still have the recovery key, unlock with it and **set a new passphrase** — credentials are kept.
- If you know the current passphrase, use **Change Passphrase** in Vault Security to rotate it without data loss.
- Losing both passphrase and recovery key means **local vault credentials cannot be decrypted**. Use **Reset Vault** to wipe the local vault on this device, clear vault host links (`authRef`), and clear local sync-collection cache, then create a new vault. Remote provider sync data is not deleted.

### Remember unlock on this device

- **Remember on device** stores session unlock material in the **OS keychain** (Windows Credential Manager / macOS Keychain / Linux secret service).
- This trades convenience for risk: anyone with access to your unlocked OS session may access vault-backed connections without re-entering the passphrase until cache expiry or **Forget device**.
- Do **not** enable remember-on-device on shared or untrusted machines.

### Google OAuth (Drive Sync)

- Official release builds embed **`GOOGLE_CLIENT_ID`** (and optionally **`GOOGLE_CLIENT_SECRET`**) for the **Drive Sync** desktop OAuth client.
- **Low risk, expected for desktop apps:** Google's installed-app model does not treat the client secret as confidential — it cannot be kept secret inside a distributed binary. This is normal for desktop OAuth and is **not** the same as leaking a server-side OAuth secret.
- User data access still requires **per-user consent** and scoped tokens; extracting the embedded client pair alone does not grant access to someone else's Google data.
- Do **not** reuse a production **web/server** OAuth client for Zync desktop builds.
- Do **not** reuse the Drive Sync client for Public URLs sign-in (and vice versa).
- Google sync tokens are stored locally; disconnect/revoke flows clear provider tokens where implemented.
- A future **PKCE-only** client (no embedded secret) is planned as hygiene improvement, not an urgent security blocker.

### Public URLs (Beta) operator notes

- Treat an active Public URL as **internet exposure of that loopback port** via Zync’s relay.
- Do not share ports that bind privileged or sensitive local services unless you intend that exposure.
- Stop/delete the share when finished. Signing out of Zync ends the local agent session; revoke GitHub/Google app access if you want the account unlinked at the provider.
- Survey / Settings → Feedback POSTs (when used) go to a Zync-operated survey API. They are optional and do not include vault secrets, SSH keys, or terminal contents.

### Backups and restore

- Treat Google Drive sync collections as **encrypted backups**, not a live shared secrets broker.
- Review restore previews before applying connection bundle restore; scoped restore can affect hosts, tunnels, snippets, and credentials together.
- Use `scripts/reset-vault-test-data.ps1` only on **test machines** — full-local-reset wipes local hosts, vault, and sync state.

---

## Scope & Future Work (not security blockers)

These are **product scope** limits today, not vulnerabilities:

- **No team/org policy controls** — vault and sync are single-user oriented; shared/team vaults are deferred to later phases.
- **No live bi-directional sync scheduling** — Google sync is manual upload/restore; there is no background auto-sync scheduler yet.
- **Plugins** — there is no standard raw-vault-secret export API. Granted remote-command or file access can nevertheless expose sensitive data outside the vault. See the implemented trust boundary above and [PLUGINS.md](./PLUGINS.md); broader credential-sharing capabilities remain deferred.
- **Public URLs Beta** — no team/org sharing, no custom domains, no pricing plans in-app; GA hardening is deferred.

### AI credential policy

AI provider API keys are encrypted in the Local Vault but remain **local only**. Zync excludes them from individual and bulk credential sync and from full Vault backup exports. This is a temporary product-policy boundary pending an owner decision about cross-device AI credential sync.

Locking the Vault blocks future API-key resolution. AI work that already resolved a key continues until that request or agent run finishes; Vault lock does not cancel active AI tasks.

Embedded desktop OAuth client credentials are **informational only** for the installed-app model — see Google OAuth guidance above.

---

## Reporting Security Issues

If you discover a vulnerability in Zync, report it privately to the maintainers rather than opening a public issue with exploit details.

---

## Related Documentation

- [VAULT.md](./VAULT.md) — vault and sync architecture
- [VAULT_ROADMAP.md](./VAULT_ROADMAP.md) — planned vault/sync work
- [TUNNELS.md](./TUNNELS.md) — SSH port forwarding (separate from Public URLs)
- [PLUGINS.md](./PLUGINS.md) — plugin trust tiers, sandbox, permissions, publisher identity, and marketplace architecture
- [CHANGELOG.md](../CHANGELOG.md) — release history
- Privacy Policy (marketing site) — `https://zync.thesudoer.in/privacy`
