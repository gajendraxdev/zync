# Terminal Ghost Suggestions

**Last updated:** 2026-07-06  
**Applies to:** Zync v2.19.2+

Fish-style **inline** command completion for Zync terminals:

- Faded ghost text suffix while typing
- Per-scope history ranking (local or connection-specific)
- Filesystem path completion (local + remote via `fs_list`)

**Parked / future work:** smarter ranking, robustness hardening, popup v2 — see [TERMINAL_GHOST_ROADMAP.md](./TERMINAL_GHOST_ROADMAP.md).

For the overall terminal stack (PTY, IPC, renderer, tab lifecycle), see [TERMINAL.md](./TERMINAL.md).

---

## Overview

Ghost suggestions run **inside the terminal input pipeline**. Handlers are serialized through `inputQueue.ts` so fast typing cannot reorder keystrokes relative to the shell.

| Surface | Component / module |
|---------|------------------|
| Inline suffix | `GhostSuggestionOverlay.tsx` |
| Input wiring | `useTerminalGhost.ts` (called from `Terminal.tsx`) |
| Settings | **Settings → Terminal → Ghost suggestions** (`settings.ghostSuggestions`) |

**Visibility:** Ghost IPC is skipped when the shell tab is hidden (`isVisibleRef`).

**Tab popup:** Removed in v2.19.2 (`336d54d`). Tab always goes to the shell (P0). Popup v2 is planned in the roadmap.

---

## File structure

### Frontend UI (terminal overlays)

| File | Role |
|------|------|
| `src/components/terminal/Terminal.tsx` | Mounts `useTerminalGhost`; passes ghost state into `TerminalHost` |
| `src/components/terminal/useTerminalGhost.ts` | Binds xterm input to ghost runtime |
| `src/components/terminal/GhostSuggestionOverlay.tsx` | Inline ghost suffix at cursor; theme via CSS variables |
| `src/components/terminal/TerminalHost.tsx` | Host layout + overlay mount |
| `src/components/terminal/TerminalContextMenu.tsx` | Optional inline accept from right-click menu |

### Frontend logic (`src/lib/ghostSuggestions/`)

| File | Role |
|------|------|
| `types.ts` | Request and inline suggestion types |
| `client.ts` | IPC: suggest / commit / accept; inline provider orchestration |
| `inputTracker.ts` | Line buffer from `onData`; accept/dismiss; history commit callback |
| `runtime.ts` | Tracker callbacks, debounce, stale-request guards, input routing |
| `pathCompletion.ts` | Path engine + command-aware heuristics + cache |
| `wslShell.ts` | WSL shell id parsing, cwd filtering, `resolveWslShellIdForPathCompletion` |
| `promptCwdSniffer.ts` | Passive cwd from PTY prompt text (PowerShell + Unix/WSL themes) |
| `cwdTracking.ts` | `cd` target resolution for `lastKnownCwd` updates |
| `escapeInput.ts` | Escape-sequence classification (cursor vs history edits) |
| `shellSuppression.ts` | Native fish/zsh autosuggest coexistence policy |
| `zshAutosuggestDetect.ts` | Probe zsh init files (host + WSL) for autosuggestions plugin |
| `cursorPosition.ts` | Cell → pixel coords via `.xterm-char-measure-element` (xterm 6) |
| `suggestionEngine.ts` | Provider scaffold (legacy) |
| `providers/historyProvider.ts` | Legacy ring-buffer scaffold; **runtime uses Rust history via IPC** |

### Backend Rust (`src-tauri/src/ghost/`)

| File | Role |
|------|------|
| `mod.rs` | Module exports |
| `types.rs` | Frecency/history models and constants |
| `parser.rs` | Prefix extraction from shell input segments |
| `ranking.rs` | Frecency + suffix scoring |
| `manager.rs` | In-memory state, persistence, suggest/candidates/commit/accept |
| `commands.rs` | Tauri: `ghost_commit`, `ghost_accept`, `ghost_suggest`, `ghost_candidates` |
| `src-tauri/src/commands.rs` | `AppState` owns `ghost_manager` |
| `src-tauri/src/fs.rs` | `fs_list` type normalization for path completion |
| `src-tauri/src/commands.rs` | `fs_list_wsl`, `wsl_get_cwd`, `read_wsl_zsh_init_files` (Windows only) |

`ghost_candidates` remains in Rust for a future popup v2; not used by the inline UI today.

### Settings + tests

| File | Role |
|------|------|
| `src/store/settingsSlice.ts` | `ghostSuggestions` schema |
| `src/components/settings/tabs/TerminalTab.tsx` | Ghost toggles (inline, context menu, providers) |
| `tests/ghostSuggestionsHelpers.test.mjs` | Runtime/path/inputTracker behavior |
| `tsconfig.agent-tests.json` | Compiles ghost helpers for agent tests |

---

## Event / data flow

```
xterm.onData
  → inputQueue (serialized)
    → useTerminalGhost / handleGhostInputEvent
      → inputTracker (inline buffer + accept keys)
        → runtime debounce → client.ts
          → history: ghost_suggest IPC (Rust manager)
          → filesystem: fs_list (Windows / SSH) or fs_list_wsl (WSL PTY)
      → GhostSuggestionOverlay
      → ghost_accept / ghost_commit on accept
```

1. User types in the terminal.
2. `InputTracker` updates line state; runtime debounces inline fetch.
3. `client.ts` merges history + filesystem into one suffix.
4. Overlay renders inline suffix.
5. Accept/commit updates backend frecency history.

---

## Key bindings

| Key | Behavior |
|-----|----------|
| **→** (Right arrow) | Accept full ghost suffix (when visible) |
| **Tab** | Always passes to shell; dismisses ghost and pauses suggestions until Enter/Ctrl+C/Ctrl+U |
| **Alt+→** / **Alt+F** | Accept next word of suffix |
| **Ctrl+→** | Accept next path component of suffix |
| **Enter** | Commit command; history score updated; clears desync |

---

## Settings (`settings.ghostSuggestions`)

**Settings → Terminal → Ghost suggestions**

| Toggle | Default | Purpose |
|--------|---------|---------|
| Inline ghost text | on | Gray suffix at cursor |
| Context menu actions | off | Accept inline suggestion from terminal context menu |
| Provider: history | on | Rust frecency history |
| Provider: filesystem | on | `fs_list` / `fs_list_wsl` path completion |
| Native shell policy | `auto` | Suppress ghost when fish/zsh autosuggest is active (`auto` / `always` / `off`) |

---

## WSL path completion (Windows)

WSL tabs must list the **Linux filesystem**, not Windows `%USERPROFILE%`. Path completion routes through `fs_list_wsl` when a WSL backend is resolved.

### Backend selection signals (defense in depth)

| Signal | Source | Role |
|--------|--------|------|
| Tab `shellOverride` | Persisted at spawn (`pendingSpawnShell` → `setTerminalShellOverride`) | Ground truth for what PTY actually runs |
| Settings `localTerm.windowsShell` | `wsl` / `wsl:Distro` | Default for new local tabs |
| Linux cwd | `lastKnownCwd`, prompt sniffer, `wsl_get_cwd` | Infer WSL when settings/tab id is stale (`default`, restored session) |
| `resolveWslShellIdForPathCompletion` | `wslShell.ts` | Merges the above; enables `fs_list_wsl` |

Prompt sniffing covers common themes including `user@host:~/path$` and `host:~ $` (no `@`, common in WSL zsh). PowerShell prompts use a separate extractor.

### Rust `fs_list_wsl` implementation note

Listing runs via `wsl.exe -- sh -lc` with the **path inlined** in the script (e.g. `"$HOME"`, `'/mnt/e/...'`). Shell assignments such as `target=$HOME` are **not reliable** when `wsl.exe` is spawned from the Windows host — `$target` ends up empty. Do not reintroduce assignment-based scripts without verifying on real spawn (Node/Rust `Command`, not interactive PowerShell).

`ls -1AF` output is parsed in Rust (`parse_wsl_ls_listing`: `/` → directory, `@` → symlink).

### WSL cold start mitigations

- Longer timeout for WSL (`WSL_FS_LIST_TIMEOUT_MS` / inline 1200 ms)
- In-memory listing cache (TTL ~1.2 s, keyed per distro + path)
- `prefetchWslHomeListing` on terminal-ready
- `fetchWslCwd` seeds Linux cwd when spawn cwd is unknown

---

## Architecture and limits

This section records **design intent, robustness, and scaling boundaries** so future changes stay aligned with what shipped in v2.19.2+.

### What is solid and standard

**Per-backend filesystem adapters.** Windows host → `fs_list`, WSL → `fs_list_wsl`, SSH → remote `fs_list`. Completion follows the PTY session’s filesystem, not a single global “local” view. This is the right shape for a desktop terminal and extends naturally to more backends.

**Cwd-driven listing.** `lastKnownCwd` + prompt sniffing + `cd` tracking mirrors how fish, IDE terminals, and many shells scope path completion. Helpers are unit-tested (`ghostSuggestionsHelpers.test.mjs`) without a live PTY.

**Layered WSL detection.** Tab shell + settings + Linux cwd + prompt regex is intentional defense in depth for restored sessions, settings changes, and custom prompts — not accidental duplication.

**Fail-soft UX.** Timeouts, stale cache fallback, skip history on bare `cd`, cursor/history desync without buffer wipe (P2), native-shell suppression policy (P3). Appropriate for inline ghost text.

**Out-of-shell completion.** Ghost runs in the renderer + IPC layer, not as a shell plugin. That matches Zync’s product model (overlay, no injection) but differs from fish/zsh-native autosuggest architecture.

### Pragmatic choices (not textbook ideal)

| Area | Today | Limit / follow-up |
|------|--------|-------------------|
| WSL listing | `wsl.exe` subprocess per cache miss | Latency on cold start; mitigated by cache/prefetch, not eliminated |
| WSL inference | Heuristic from Linux cwd (`~`, `/`, `/mnt/…`) | Git Bash or mis-tagged tabs could theoretically confuse; prefer immutable `sessionBackend` on tab (roadmap) |
| Cwd sniffing | Regex on prompt text | Does not scale to every theme; OSC 7 in shell config is the durable fix (roadmap/docs) |
| Provider merge | Fixed order in `client.ts` (path → history) | Add ranked provider registry before git/docker/kubectl sources |
| List cache | In-process `Map`, ~128 keys, short TTL | Fine for tens of tabs; not a shared/long-lived index |

### Scalability snapshot

| Dimension | v2.19.2+ posture |
|-----------|------------------|
| More WSL distros | Supported via `wsl:Distro` + per-distro cache keys |
| Many concurrent WSL tabs | OK with cache; watch `wsl.exe` spawn rate under heavy typing |
| macOS / Linux desktop | WSL commands are `#[cfg(windows)]`; host path unchanged |
| SSH remote | Separate `fs_list` path; ghost scope per connection |
| New suggestion sources | Requires extending `client.ts` or extracting a provider pipeline |

**Verdict:** Robust and standard **for an integrated Windows terminal with WSL and SSH** at product scale. Refactor before sub-50 ms completion latency requirements or a large provider ecosystem.

### Recommended hardening (roadmap-aligned)

1. **P0 — `sessionBackend` on terminal tab** at spawn (`windows` \| `wsl` \| `ssh`), immutable; stop inferring WSL from cwd alone.
2. **P1 — WSL list sidecar** — long-lived helper inside distro (JSON over pipe) instead of per-request `wsl.exe`.
3. **P2 — OSC 7** — document/default snippets for bash/zsh in WSL so prompt sniffing is fallback only.
4. **P3 — Provider registry** — fish-style ranked merge for history, path, git, etc.

Details and popup v2 constraints remain in [TERMINAL_GHOST_ROADMAP.md](./TERMINAL_GHOST_ROADMAP.md).

---

## Known gaps

See [TERMINAL_GHOST_ROADMAP.md](./TERMINAL_GHOST_ROADMAP.md) for the full parked plan. Highlights:

- Line buffer desync after shell Tab completion (Tab always passes to shell; ghost pauses until reset)
- Prefix-only matching; no fuzzy shorthand
- Cold start on new SSH connections
- WSL: per-request `wsl.exe` spawn cost; no sidecar yet
- WSL: cwd inference heuristics; no immutable `sessionBackend` field yet
- Prompt sniffing: custom themes may need regex or OSC 7 follow-up
- Provider pipeline: fixed merge order in `client.ts` (no plugin registry)

**Shipped in v2.19.2+ (no longer gaps):** P2 escape handling (cursor/history desync without buffer wipe), P3 native shell suppression policy, WSL path completion via `fs_list_wsl`, zsh autosuggest detection probe.

---

## Notes for changes

- Keep overlay colors **CSS-variable-based** for theme compatibility.
- Parser/ranking changes → update `parser.rs`, `ranking.rs`, `manager.rs` and TS tests.
- Key routing changes → update `inputTracker.ts`, `escapeInput.ts`, and `tests/ghostSuggestionsHelpers.test.mjs`.
- WSL path changes → update `wslShell.ts`, `pathCompletion.ts`, Rust `fs_list_wsl_impl`; **never use shell variable assignment** in `wsl.exe -lc` scripts spawned from the host (see **WSL path completion** above).
- Do not add terminal key buffering unless a reproducible xterm sequence-split bug is proven.
- When rebuilding popup, follow popup v2 constraints in the roadmap (non-Tab trigger).

---

## Related documents

- [TERMINAL_GHOST_ROADMAP.md](./TERMINAL_GHOST_ROADMAP.md) — parked robustness + intelligence + popup v2 plan
- [TERMINAL.md](./TERMINAL.md) — integrated terminal architecture
- [SESSION_PERSISTENCE.md](./SESSION_PERSISTENCE.md) — tab restore (ghost history is per connection scope)