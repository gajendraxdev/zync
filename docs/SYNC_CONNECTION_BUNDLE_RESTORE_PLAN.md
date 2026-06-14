# Sync Connection Bundle + Grouped Restore UX Plan

## Status

- **Owner:** Core app team
- **Document type:** Implementation plan (pre-code)
- **Last updated:** 2026-06-14
- **Scope:** Grouped Sync & Backup UX (item #8), connection-scoped restore orchestration, risk mitigations
- **Depends on:** Phase 3 per-domain sync (implemented), Phase 4 selective-sync direction (draft)

This document records the validated product/technical plan from design review **before**
implementation. It complements — does not replace — per-domain backend storage.

---

## Related documents

- [`PHASE3_APPDATA_SYNC_PLAN.md`](./PHASE3_APPDATA_SYNC_PLAN.md) — per-domain sync scaffolding and current UI
- [`PHASE4_SELECTIVE_PROVIDER_SYNC_MODEL.md`](./PHASE4_SELECTIVE_PROVIDER_SYNC_MODEL.md) — long-term selective materialization model
- [`VAULT_PROVIDER_SYNC_KEY_MODEL.md`](./VAULT_PROVIDER_SYNC_KEY_MODEL.md) — credential restore, `logicalId`, skip/conflict rules
- [`VAULT_CREDENTIAL_IDENTITY_MODEL.md`](./VAULT_CREDENTIAL_IDENTITY_MODEL.md) — host `authRef` → `credentialId`

---

## Problem

Today the Sync & Backup workspace exposes **five peer domains** (vault, hosts, tunnels,
snippets, settings) in a flat table (`VaultSyncCard`). That is accurate at the storage layer
but misleading at the product layer:

- **Tunnels** and **host-scoped snippets** depend on a host (`connection_id` / `connectionId`).
- **Vault credentials** are shared secrets referenced by hosts, not embedded in host records.
- **Global snippets** and **settings** are app-scoped and do not depend on a host.

Restore behavior is only partially aligned:

- Host restore already pulls **referenced vault credentials** first (subset, deduped by `logicalId`).
- Host restore does **not** yet restore tunnels or host-scoped snippets for those hosts.
- Users can restore hosts and still miss port forwards / per-host snippets — setup feels broken.

---

## Goals

1. **Grouped UX** that matches how users think: Connections vs App-wide vs Vault.
2. **Restore orchestration** for connection-scoped data without merging sync domains in the backend.
3. **Idempotent restore** — skip creds/records already local and up to date.
4. **Per-host scope** — restoring 2 of 10 hosts restores only related tunnels/snippets for those 2.
5. **Sync safety** — disabling a domain still means that domain is not uploaded.

## Non-goals (this plan)

- Merging domains into one remote blob or one sync cursor.
- Auto-sync on domain toggle (manual sync remains unless a separate auto-sync engine is added).
- Full Phase 4 entity graph (`HostEntity` with multiple providers) — orchestration uses today's domain commands.
- Replacing credential preview/conflict modals for full vault restore.

---

## Mental model: three scopes

| Scope | Domains / data | Depends on host? |
|-------|----------------|------------------|
| **Connection-scoped** | Hosts, tunnels, host-scoped snippets | Tunnels/snippets yes; hosts are the anchor |
| **App-scoped** | Global snippets (`connectionId` empty), settings allowlist | No |
| **Credential-scoped** | Vault credentials (`logicalId`) | Referenced by hosts; shared across many hosts |

**Rule:** A host **references** a credential via `authRef.credentialId`. It does not own the credential.

---

## Sync vs restore (keep separate)

| Concern | Behavior |
|---------|----------|
| **Sync (upload)** | Per-domain commands only (`sync_hosts_upload`, `sync_tunnels_upload`, …). Grouped UI is visual; optional “Sync connections” macro runs uploads **only for enabled** domains. |
| **Restore (download)** | May orchestrate multiple domains in dependency order for connection-scoped restore. |

Enabling host sync must **not** implicitly upload tunnels if the tunnels domain is disabled.

---

## UX plan: item #8 split

Item #8 (“`VaultSyncCard` progressive setup”) splits into two deliverables:

### 8a — Progressive provider setup (independent)

Wizard-style flow before the domain table:

1. Connect Google Drive
2. Set up / unlock Google sync encryption
3. Then reveal domain controls

**Does not** require the restore orchestrator. Can ship earlier if first-time setup confusion is the main pain.

### 8b — Grouped domains + Restore connections (depends on orchestrator)

Replace the flat five-row table with:

```text
▼ Connections
  Hosts                    [Sync] [Restore connections]
  └─ ☑ Host definitions
     ☑ Tunnels (for restored/selected hosts)
     ☑ Host-scoped snippets
     ☑ Referenced vault credentials (if vault domain enabled)

▼ App-wide
  Global snippets          [Sync] [Restore]
  Settings                 [Sync] [Restore]

▼ Vault
  All credentials          [Sync] [Restore]  (preview modal; skips existing logicalIds)
```

**Advanced:** Per-domain sync/restore remains available (today's behavior) for power users.

Copy for creds on connection restore: *“Referenced credentials are restored once and shared by all hosts that use them.”*

---

## Backend plan: `sync_connections_restore`

New orchestrator command (name tentative). **Does not** add a sixth sync domain.

### Inputs

```ts
interface SyncConnectionsRestoreArgs {
  provider: 'google';
  hostLogicalIds?: string[];  // omit = all eligible remote hosts in filter
  includeTunnels?: boolean;   // default true
  includeHostSnippets?: boolean; // default true
  includeReferencedCredentials?: boolean; // default true
}
```

### Ordered steps

1. **Resolve host set** — all remote hosts or `hostLogicalIds` subset.
2. **Restore referenced vault credentials** (if enabled) — union of `authRef.credentialId` across host set; each `logicalId` once. Reuse `restore_credentials_from_provider_records` + `decide_restore_action` (skip stale/unchanged).
3. **Restore hosts** — reuse `apply_hosts_restore_records`.
4. **Restore tunnels** (if enabled) — only records where `connection_id` ∈ successfully restored host logical ids.
5. **Restore host-scoped snippets** (if enabled) — only records where `connectionId` matches restored host ids (non-empty).
6. **Relink vault refs** — reuse existing repair/relink after credential restore.

### Orphan policy

If a tunnel or host-scoped snippet references a `connection_id` **not** in the restored host set:

- **Skip** the record (do not create dangling local data).
- Count as `skippedOrphaned` in the result payload.

### Result shape (illustrative)

Per-step counts: scanned, restored, updated, skipped, skippedOrphaned, failed, conflicts (credentials).

---

## Risk mitigations

| Risk | Mitigation |
|------|------------|
| **Over-bundling sync** | No implicit cross-domain upload. Group checkboxes map 1:1 to existing domain enable flags. “Sync connections” is a macro over **enabled** domains only. |
| **Under-bundling restore** | `sync_connections_restore` chains creds → hosts → tunnels → host-snippets. Primary CTA: **Restore connections**. |
| **Duplicate credentials** | Restore cred set = union of referenced ids; vault keyed by `logicalId`; `decide_restore_action` skips unchanged/stale. |
| **Tunnels/snippets on wrong host** | Gate on `eligible_connection_ids` from successfully restored hosts; skip orphans; partial restore uses selected `hostLogicalIds` only. |

---

## Implemented today (baseline)

| Behavior | Status |
|----------|--------|
| Per-domain sync upload/restore | ✅ |
| Host restore → referenced creds first | ✅ (`sync_hosts_restore`) |
| Credential skip/conflict on restore | ✅ (`decide_restore_action`, preview modal for full vault restore) |
| Vault ref relink after host restore | ✅ |
| Tunnels/snippets with host restore | ❌ |
| Grouped Sync UI / progressive setup | ❌ |
| `sync_connections_restore` orchestrator | ❌ |
| Orphan tunnel/snippet filter | ❌ |

---

## Phase A — Scenario validation (no code)

Agree expected behavior before implementation:

| # | Scenario | Expected |
|---|----------|----------|
| 1 | **New device** — empty local, restore connections | Creds (referenced) → hosts → tunnels → host-snippets; globals unchanged until App-wide restore |
| 2 | **Partial** — restore 2 of 10 hosts | Only those 2 hosts + their tunnels/snippets + their cred refs |
| 3 | **Shared cred** — 3 hosts, same `credentialId` | Cred restored **once**; all 3 hosts relink |
| 4 | **Cred already local** — same `logicalId`, same revision | Skipped; host still restores |
| 5 | **Tunnels domain sync off** — user runs Sync connections | Host upload runs; tunnel upload skipped (domain disabled) |
| 6 | **Orphan tunnel** — tunnel refs host not in restore set | Tunnel skipped, `skippedOrphaned` reported |

---

## Implementation order

```text
Phase A  Scenario sign-off (this doc + table above)
   ↓
Phase B  Backend: sync_connections_restore + orphan filter + structured result
   ↓
Phase C  UI 8b: grouped VaultSyncCard + Restore connections wired to orchestrator
   ↓
Phase D  UI 8a: progressive connect/encryption setup (can parallelize after B if needed)
   ↓
Phase D  Restore preview modal (counts, orphans, credential conflicts summary)
```

**Default sequence:** A → B → C, with 8a (D) anytime after or in parallel with B.

**Do not** ship 8b “Restore connections” before Phase B — the button would not match behavior.

---

## Testing matrix (add to Phase 3 closure)

1. Orchestrator happy path (new device).
2. Partial host selection scope.
3. Shared credential dedup across multiple hosts.
4. Skip unchanged credential on second restore.
5. Orphan tunnel/snippet skipped with correct counts.
6. Domain disabled — sync macro does not upload disabled domain.
7. UI grouping — toggles persist to existing `domainPolicies` / `hostsSyncEnabled`.
8. Regression — per-domain restore still works under Advanced.

---

## Exit criteria

- [ ] Phase A scenarios reviewed and signed off.
- [ ] `sync_connections_restore` implemented with per-step stats and orphan skips.
- [ ] Sync & Backup UI shows Connections / App-wide / Vault groups.
- [ ] Restore connections uses orchestrator; Advanced retains per-domain actions.
- [ ] 8a progressive setup shipped or explicitly deferred with reason.
- [ ] Manual smoke on empty-local profile documented in Phase 3 closure notes.

---

## Design rules to preserve

```text
Provider domains stay separate in storage and cursors.
UI grouping is not backend merging.
Restore order follows dependencies; sync order follows user-enabled domains.
logicalId / credentialId is the identity anchor for skip and dedup.
Connection-scoped restore is per selected host set, not “everything on Drive.”
```