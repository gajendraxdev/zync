# Zync Terminal — Optimization & Robustness Roadmap

**Last updated:** 2026-06-17
**Audit basis:** Full-stack review of `terminal/Terminal.tsx`, `TerminalManager.tsx`, `pty.rs`, `terminalSlice.ts`, ghost suggestions, and terminal IPC.

Plans and prioritized work for terminal performance, reliability, and code quality. For ghost-suggestion architecture, see [TERMINAL_GHOST_SUGGESTIONS.md](./TERMINAL_GHOST_SUGGESTIONS.md). For session/tab restore behavior, see [SESSION_PERSISTENCE.md](./SESSION_PERSISTENCE.md).

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What Is Already Solid](#2-what-is-already-solid)
3. [Resize Behavior (Expected vs Buggy)](#3-resize-behavior-expected-vs-buggy)
4. [P0 — Highest Impact](#4-p0--highest-impact)
5. [P1 — Robustness & Code Quality](#5-p1--robustness--code-quality)
6. [P2 — Polish & Longer-Term](#6-p2--polish--longer-term)
7. [Quick Wins vs Larger Refactors](#7-quick-wins-vs-larger-refactors)
8. [Suggested Implementation Order](#8-suggested-implementation-order)
9. [Key File Map](#9-key-file-map)
10. [Exit Criteria](#10-exit-criteria)
11. [GPU Acceleration (WebGL Renderer)](#11-gpu-acceleration-webgl-renderer)

---

## 1. Executive Summary

The terminal stack has strong foundations: generation-gated lifecycle events, frontend input batching, remote output coalescing, remote resize coalescing, and a module-level xterm cache for tab persistence.

The largest remaining costs are:

| Area | Problem |
|------|---------|
| **Scale** | N tabs ⇒ N live PTYs, N ResizeObservers, N reader tasks (even when hidden) |
| **IPC** | Local PTY output is unbatched; remote path already batches |
| **Correctness** | Async `onData` can reorder keystrokes; input not gated on `terminal-ready` |
| **Structure** | `terminal/Terminal.tsx` (~1,300 lines) still couples xterm, IPC, ghost, theme, search, layout |
| **Resize** | Five overlapping fit/resize paths; hidden tabs still observe resize |

Recent hardening (commit `c10c082`): layout-transition safety timeout, always-on visual fit during transitions, window-resize refit, dev single-instance disabled in debug builds.

---

## 2. What Is Already Solid

- **Generation-gated events** — stale output/exit ignored after restart (`Terminal.tsx` listeners filter on `generation`)
- **Frontend input batching** — 4ms window, 64-byte threshold, immediate flush for control chars (`INPUT_BATCH_MS`, `INPUT_FLUSH_THRESHOLD`)
- **Remote output batching** — 8ms / 4KB coalescing in `pty.rs` (`REMOTE_OUTPUT_BATCH_MS`, `REMOTE_OUTPUT_FLUSH_THRESHOLD`)
- **Remote resize coalescing** — latest cols/rows wins in SSH reader task (`pty.rs` resize channel drain)
- **xterm cache** — `terminalCache` preserves scrollback across tab reorder/remount
- **Layout transition hardening** — visual fit during animation; PTY IPC deferred until settle; 500ms safety timeout
- **Ghost stale-result guards** — line-buffer checks and request sequencing in ghost runtime
- **OSC 7 CWD tracking** — passive shell-integration path, no injection
- **Remote SSH flush on exit** — avoids truncated tail output before `terminal-exit`

---

## 3. Resize Behavior (Expected vs Buggy)

**Expected (all terminals, including Windows PowerShell):**

- Historical scrollback does **not** reflow when the window is resized or maximized
- Lines written at a narrow width stay wrapped at those break points
- **New** commands after resize use the new column count

**Buggy (Zync-specific — address via roadmap items):**

- xterm canvas not filling the host (large black margins, tiny render area)
- Literal duplicate rendering of the same framebuffer
- Garbled/overlapping text after resize
- Backend PTY cols/rows out of sync with xterm canvas (hidden-tab resize during layout transition)

xterm on Windows ConPTY disables scrollback reflow by design (`windowsPty` compatibility). Do not treat “old output stays narrow” as a bug.

---

## 4. P0 — Highest Impact

### 4.1 Lazy PTY spawn (active tab only)

**Today:** `TerminalManager` mounts every tab; inactive tabs are `invisible` but still spawn PTYs and run ResizeObservers.

**Files:** `src/components/terminal/TerminalManager.tsx`, `src/components/terminal/Terminal.tsx`

**Proposal:** Keep xterm instances mounted for scrollback; spawn PTY only for the active tab. Suspend or close inactive PTY readers on tab blur.

**Impact:** Linear reduction in shells, SSH channels, memory, and IPC with tab count.

---

### 4.2 Serialize async `onData` (input reorder fix)

**Today:** `term.onData(async (data) => { ... await handleGhostInputEvent ... })` — concurrent async handlers can interleave at `await` and call `queueTerminalInput` out of order.

**Files:** `src/components/terminal/Terminal.tsx`, `src/lib/ghostSuggestions/runtime.ts`

**Proposal:** Per-session input queue. Ghost logic runs inside the queue worker; PTY writes always leave in order.

**Impact:** Fixes fast-typing corruption during Tab popup / slow ghost IPC.

---

### 4.3 Gate input on `terminal-ready`

**Today:** `spawned = true` is set before `terminal:create` completes. `starting` is written but never read. Early keystrokes can produce silent `"Session not found"` from backend.

**Files:** `src/components/terminal/Terminal.tsx`, `src-tauri/src/pty.rs`, `src-tauri/src/commands.rs`

**Proposal:** Buffer or drop input while `starting === true`; flush after `terminal-ready-${sessionId}` for matching `generation`.

---

### 4.4 Batch local PTY output

**Today:** Local reader emits every `read()` immediately. Remote reader uses 8ms / 4KB batching.

**Files:** `src-tauri/src/pty.rs` (`emit_terminal_output` in local `spawn_blocking` loop ~line 387)

**Proposal:** Mirror `REMOTE_OUTPUT_*` flush logic for local PTY reads.

**Impact:** Major IPC reduction for fast local output (`npm install`, large logs).

---

## 5. P1 — Robustness & Code Quality

| # | Item | Issue | Proposal |
|---|------|-------|------------|
| 5.1 | Hidden-tab resize | `ResizeObserver` runs when `!isVisible` | Skip fit + IPC unless `isVisibleRef.current` |
| 5.2 | Resize path overlap | 5 mechanisms trigger fit/sync | Single debounced `scheduleResize()` (50–100ms trailing edge) |
| 5.3 | Spawn duplication | 3 copies of spawn/restart boilerplate | Extract `spawnTerminalSession({ reason })` |
| 5.4 | Dead `connection-wakeup` | Listener in `terminal/Terminal.tsx`; nothing dispatches event | Remove or wire from file-manager reconnect |
| 5.5 | Store ↔ UI coupling | ~~`terminalSlice` imported lifecycle from React component~~ | **Done (partial):** `terminalCache`, `destroyTerminalInstance`, ligatures, renderer setup in `src/lib/terminal/`; UI shell remains in `terminal/Terminal.tsx` |
| 5.6 | Split write paths | `TerminalManager` sends `terminal:write` directly for snippets/plugins | Route through shared `queueTerminalInput` |
| 5.7 | Child cleanup | Local `close()` aborts reader; child kill relies on `Drop` | Explicit `child.kill()` / wait on local handle |
| 5.8 | Input batch encoding | Full `pendingInput` re-encoded each keystroke | Track `pendingInputBytes` incrementally |
| 5.9 | Disconnect tab wipe | `clearTerminals` on disconnect destroys cache + PTYs | Document UX; optional preserve `pendingRestore` metadata |

---

## 6. P2 — Polish & Longer-Term

- **GPU acceleration (WebGL renderer)** — implemented; see [§11](#11-gpu-acceleration-webgl-renderer)
- Skip ghost suggestion IPC when tab is hidden
- Binary Tauri event payloads instead of `number[]` serde for output
- Integration tests: spawn → resize → generation → close sequences
- Split `Terminal.tsx` into `TerminalHost`, lifecycle hook, input pipeline, theme hook
- Central terminal service API for store (`terminalService.destroy(id)`)
- Optional `reflowCursorLine` / `windowsPty` tuning for Windows ConPTY edge cases
- Replace private xterm `_core._renderService` usage in `cursorPosition.ts` when upgrading xterm

---

## 7. Quick Wins vs Larger Refactors

### Quick wins (hours – 1 day each)

1. Gate `ResizeObserver` on `isVisibleRef`
2. Read `starting` / gate flush on `terminal-ready`
3. Local output batching in `pty.rs`
4. Extract `spawnTerminalSession()` helper
5. Remove or implement `connection-wakeup`
6. Track `pendingInputBytes` in input batcher
7. Route `TerminalManager` snippet writes through batching helper

### Larger refactors (multi-day)

1. **Lazy tab activation model** — biggest perf win
2. **Split `Terminal.tsx`** — maintainability
3. **Input pipeline module** — serial queue + ghost as middleware
4. **Central resize coordinator** — one subscriber for layout/window/visibility
5. **Terminal service layer** — decouple Zustand from React component exports

---

## 8. Suggested Implementation Order

```
Phase 1 (1–2 days)
  - Input queue (4.2)
  - Ready gating (4.3)
  - Hidden-tab resize gate (5.1)

Phase 2 (2–3 days)
  - Lazy PTY spawn (4.1)
  - Local output batching (4.4)

Phase 3 (2–3 days)
  - Spawn helper (5.3)
  - ~~terminalCache module extraction (5.5)~~ — done (cache, ligatures, instance API, renderer setup)
  - Dead code cleanup (5.4)

Phase 4 (ongoing)
  - Resize unification (5.2)
  - Child kill (5.7)
  - Integration tests

Phase 5 — **done**
  - WebGL renderer with canvas fallback (§11)
  - Settings toggle + context-loss recovery + renderer status panel
```

---

## 9. Key File Map

| File | Responsibility |
|------|----------------|
| `src/components/terminal/Terminal.tsx` | xterm UI shell: resize, IPC, ghost integration, theme |
| `src/components/terminal/TerminalManager.tsx` | Multi-tab shell; mounts all tabs |
| `src/store/terminalSlice.ts` | Tab CRUD; calls `destroyTerminalInstance` from `lib/terminal` |
| `src-tauri/src/pty.rs` | PTY spawn, read/write, resize, local + remote paths |
| `src-tauri/src/commands.rs` | `terminal_create`, `terminal_write`, `terminal_resize` |
| `src/lib/tauri-ipc.ts` | Channel mapping; fire-and-forget `send()` |
| `src/lib/ghostSuggestions/*` | Input tracking, inline/popup suggestions |
| `src/index.css` | `.terminal-container` sizing overrides |
| `src/lib/terminal/terminalCache.ts` | Module-level xterm instance cache |
| `src/lib/terminal/ligatures.ts` | `LigaturesAddon` load/dispose |
| `src/lib/terminal/rendererSetup.ts` | GPU + ligatures activation orchestration |
| `src/lib/terminal/instanceApi.ts` | `destroyTerminalInstance`, `getTerminalRecentLines` |
| `src/lib/terminal/renderer*.ts` | GPU policy, WebGL load, canvas fallback, diagnostics |
| `src/lib/terminal/index.ts` | Public API for UI + store |
| `@xterm/addon-webgl` | Loaded lazily by `rendererController.ts` |
| `@xterm/addon-canvas` | Loaded on WebGL → canvas transitions |

---

## 10. Exit Criteria

Terminal optimization work can be considered **Phase 1 complete** when:

- [ ] Keystrokes cannot reorder under fast typing + ghost Tab resolution
- [ ] No silent `"Session not found"` on input immediately after tab open
- [ ] Hidden tabs do not trigger fit or PTY resize IPC
- [ ] Local fast output does not saturate IPC (batched comparable to remote)

**Phase 2 complete** when:

- [ ] Only the active tab holds a live PTY (xterm scrollback preserved for inactive tabs)
- [ ] `Terminal.tsx` lifecycle/spawn logic lives in a testable module
- [ ] `connection-wakeup` removed or wired
- [ ] Basic integration tests cover spawn/resize/close/generation

**GPU acceleration (Phase 5) complete** when:

- [x] WebGL renderer active by default on supported Tauri/WebView2 targets (`gpuAcceleration: true`)
- [x] Automatic fallback to canvas when WebGL init or context loss occurs
- [x] Ligatures + GPU compatible (WebGL → ligatures → WebGL reactivate)
- [x] WebGL2 probe before load; init failure vs context-loss split
- [x] Renderer session ownership in `lib/terminal/rendererSession.ts`
- [x] Automated tests: policy, capability, session, controller sync
- [ ] Manual QA: transparency + resize/fit under WebGL on Windows WebView2 (your step)

---

## 11. GPU Acceleration (WebGL Renderer)

### Status: implemented (modular)

GPU rendering is implemented via `src/lib/terminal/` and wired from `terminal/Terminal.tsx`.

| Module | Role |
|--------|------|
| `types.ts` | `TerminalRendererKind`, `TerminalRendererState` |
| `rendererPolicy.ts` | Pure policy: WebGL vs canvas from settings + context-loss blocks |
| `webglCapability.ts` | Cached WebGL2 probe before attempting load |
| `rendererLifecycle.ts` | Dispose / explicit canvas fallback + screen refresh |
| `rendererSession.ts` | Per-`sessionId` renderer state ownership |
| `rendererController.ts` | Lazy WebGL load, init vs context-loss failure paths |
| `rendererDiagnostics.ts` | Renderer health summaries for settings UI |
| `terminalCache.ts` | Shared xterm instance cache |
| `ligatures.ts` | Ligatures addon load/dispose |
| `rendererSetup.ts` | Applies GPU + ligatures in xterm-recommended order |
| `instanceApi.ts` | Tab destroy + AI context line export |
| `index.ts` | Public API surface for UI, store, and tests |

**Settings:** `settings.terminal.gpuAcceleration` (default `true`). Toggle in Settings → Terminal. Compatible with font ligatures. **Renderer status** panel shows active renderer for the focused tab.

**Tests:** `npm run test:terminal-renderer` (policy, WebGL probe, session, controller, diagnostics)

### Previous state (pre-implementation)

| Layer | Renderer | GPU? |
|-------|----------|------|
| **Before** | xterm 5 default **Canvas** (2D CPU) | No |
| **Package installed** | `@xterm/addon-webgl` ^0.19.0 | Was not loaded |
| **Also installed** | `@xterm/addon-canvas` ^0.7.0 | Loaded on WebGL dispose / GPU off |

`terminal/Terminal.tsx` loads `FitAddon`, `SearchAddon`, `WebLinksAddon`. GPU and ligatures load via `lib/terminal`.

```765:772:zync/src/components/terminal/Terminal.tsx
      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      searchAddon = new SearchAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.loadAddon(searchAddon);
```

### Why enable it

WebGL2 moves glyph atlas rendering to the GPU. Benefits for Zync:

- **Fast output** — `npm install`, log tailing, build output (pairs well with local output batching §4.4)
- **Large scrollback** — smoother scroll and refresh with deep buffers
- **Resize** — fewer canvas repaint stalls during `fit()` on maximize/sidebar drag
- **Multi-tab** — lower CPU per tab once lazy PTY spawn (§4.1) limits active shells

WebGL does **not** fix scrollback reflow on maximize (that remains correct terminal semantics per §3).

### Constraints and conflicts

| Concern | Detail |
|---------|--------|
| **Font ligatures** | `LigaturesAddon` uses character joiners; WebGL renderer handles joined ranges. Activation order: WebGL → ligatures → WebGL reactivate (texture atlas picks up `font-feature-settings`). |
| **Transparency** | Zync uses `allowTransparency: true` and host-level `color-mix` backgrounds. Test WebGL + transparent host on Windows WebView2; fall back if alpha compositing glitches. |
| **Context loss** | Browser/GPU can drop WebGL context (OOM, sleep/resume, driver reset). Must handle `webglcontextlost` — dispose `WebglAddon`, fall back to canvas, optionally retry on next focus. |
| **Tauri WebView2** | WebGL2 is generally available on Windows 10+; still probe at runtime and never assume success. |
| **Ghost overlays** | `GhostSuggestionOverlay` reads cell metrics from xterm internals — re-test pixel alignment under WebGL. |

### Recommended implementation

Mirror the existing lazy `LigaturesAddon` pattern in `Terminal.tsx`:

1. **Settings** — add `settings.terminal.gpuAcceleration: boolean` (default `true` on desktop).
2. **Load order** — after `term.open(container)`, before heavy output:
   ```ts
   import { WebglAddon } from '@xterm/addon-webgl';
   const addon = new WebglAddon();
   addon.onContextLoss(() => { /* dispose, mark cache webgl=false, canvas fallback */ });
   term.loadAddon(addon);
   ```
3. **Fallback chain** — `WebGL → Canvas (default) → log warning`; never brick the terminal.
4. **Ligatures gate** — if `fontLigatures && gpuAcceleration`, prefer ligatures and skip WebGL (document in Settings UI).
5. **Cache fields** — extend `TerminalCache` with `webglAddon?`, `renderer: 'webgl' | 'canvas'`, `webglLoadPromise?`.
6. **Dispose** — `destroyTerminalInstance` must dispose WebGL addon before `term.dispose()`.
7. **Refit** — after WebGL load, call existing `refitTerminal()` + `refreshTerminalScreen()`.

### Settings UI (TerminalTab)

Add toggle under Typography or a new "Performance" group:

- **GPU acceleration (WebGL)** — default on; tooltip: "Faster rendering for large output. Disable if you see visual glitches. Incompatible with font ligatures."

### Testing matrix

| Scenario | Pass criteria |
|----------|---------------|
| Windows WebView2, default font | WebGL active; fast `cat` of large file stays responsive |
| Maximize / sidebar resize | No canvas duplication; fit still correct |
| Enable ligatures | WebGL off; ligatures render |
| Enable terminal transparency | No double-alpha or black flash |
| Sleep / resume laptop | Context loss recovers or falls back without blank terminal |
| Integrated GPU + remote desktop | Graceful canvas fallback |

### Priority

**Shipped** as modular Phase 5 foundation. Future work: move `terminalCache` into `src/lib/terminal/` and route all lifecycle through the service layer (roadmap §5.5, §7 larger refactors).

### Future-proofing notes

- Policy is pure (`rendererPolicy.ts`) — easy to unit test and extend (e.g. explicit `@xterm/addon-canvas`, Metal renderer).
- `webglContextLossBlocked` prevents retry loops after GPU context loss only; init/probe failures remain retryable.
- `isWebgl2Available()` probes before loading the addon.
- Renderer state lives in `rendererSession.ts`, not on `TerminalCache`.
- Ligatures and WebGL remain mutually exclusive by policy, not ad-hoc UI checks.
- `clearTerminalRendererSession` is called from `destroyTerminalInstance` to avoid GPU leaks on tab close.

### References

- [@xterm/addon-webgl README](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl) — context loss handling
- [@xterm/addon-ligatures README](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-ligatures) — canvas renderer requirement
- `package.json` — `@xterm/addon-webgl`, `@xterm/addon-canvas` already listed

---

## Related Documents

- [TERMINAL_GHOST_SUGGESTIONS.md](./TERMINAL_GHOST_SUGGESTIONS.md) — ghost suggestion architecture
- [SESSION_PERSISTENCE.md](./SESSION_PERSISTENCE.md) — tab/terminal session restore
- [SETTINGS_SYSTEM.md](./SETTINGS_SYSTEM.md) — `settings.terminal` options