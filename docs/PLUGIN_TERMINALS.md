# Plugin-hosted terminals

**Updated:** 2026-10-01
**Status:** staged implementation; not a released plugin API.

## Goal and current status

Let a plugin place a real interactive SSH terminal inside its own UI without
giving its iframe an SSH connection, a workspace terminal handle, or permission
to silently type commands. Docker is the first intended consumer, not a special
case in the host. Other plugins use the same service and rendering contract.

The existing `sshCommand.execute` API remains the bounded, non-interactive command
API. Existing built-in plugins and workspace terminals are unchanged.
The native service and permission catalog are now
implemented. Host pane surfaces and optional worker/SDK APIs are wired in the
experimental 2.1.0-beta.4 SDK, published under `beta` on 2026-10-01. A visible
proposal requests host confirmation once; the SSH session starts only after
approval. Docker's local integration now uses interactive shells and a copied
command fallback for unsupported hosts.

Implemented foundation:

- Immutable launch proposals and strict runtime validation.
- Pane-bounded surface allocation, keeping terminal size separate from clipping.
- Host lifecycle coordinator with asynchronous authorization, confirmation,
  cancellation, capacity reservations, late-create cleanup, and frame ownership.
- Focused tests for malformed proposals, geometry and lifecycle races.

Native authority and SSH streaming are implemented in a separate Rust module.
Renderer integration and SDK transport are wired into `PluginPanel`. Packaged
UI was tested by the operator, who confirmed working dropdowns, copy and terminal
rendering. A WebView2 crash was observed once and remains unresolved. Real-server
resource profiling and stable-release validation remain pending.

## Ownership and boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| Plugin worker | Validated task proposal and plugin state | SSH sessions, raw PTY IDs, terminal transport |
| Plugin iframe | Slot element, plugin layout, ordinary pane messages | xterm instance, terminal output, keyboard injection |
| Host terminal service | Approval, session UI lifecycle, trusted renderer | Plugin-specific command semantics |
| Native broker | Grants, package identity, opaque handles, pane/connection lease, resource limits | Plugin layout |
| Native SSH engine | PTY channel, bounded I/O and teardown | Workspace layout |

The TypeScript service is a lifecycle coordinator, **not** the security boundary.
Every native operation must check authority independently. Knowing a JS UI session
number, pane ID, or slot ID must never allow access to a native session.

Reuse existing broker leases: runtime removal, pane unbinding and rebinding
invalidate the lease even if the pane later reconnects to the same server. Bind
the SSH session generation as well as the pane token. Never fall back to the
currently active workspace connection.

## Experimental API flow

The optional worker `sshTerminal.context/prepare` API returns only connection
tokens and public offers. `@zync-sh/plugin-sdk/terminal` exports
`mountTerminalSurface`; its version-1 handshake detects older hosts and resolves
`ready` to false. Native document IDs, approval tokens and I/O never enter the
plugin. The helper requires an axis-aligned slot of at least 240 × 100 CSS pixels.

1. A plugin worker proposes a program and string arguments for a pane. It carries
   the expected connection token from an earlier host-bound request. The iframe
   cannot provide a connection ID or a workspace terminal ID.
2. Native preflight verifies the plugin, permission, package and pane binding;
   stores an immutable proposal and returns an opaque, pane-scoped offer.
3. The worker passes the offer to its UI using the existing pane message channel.
4. The UI mounts that offer into a slot element through the SDK surface helper.
   Slot registration reserves space; it does not start a process.
5. Once the slot is visible and the app is focused, Zync requests confirmation
   once per proposal, naming the plugin, server and proposed program/arguments.
   Only approval in that host-owned dialog starts the session. Resizing, returning
   from a dialog, cancellation and expiry never automatically repeat the prompt.
   A **Review launch** control remains available if automatic presentation could
   not run, such as when the app was unfocused.
6. Native creation consumes the approved offer exactly once, revalidates the
   package, grants, lease and generation, and allocates the SSH PTY.
7. Host xterm input goes to that dedicated native session. Normal user typing
   does not cause a fresh approval for every line. Output goes only to the host
   renderer, not to plugin pane messages.
8. Slot disposal or its document being replaced closes the session. Natural exit
   shows an exited state; restart is explicit and creates a new approved session.

Initial proposal shape:

```ts
{
  program: string;
  args: readonly string[];
  expectedConnectionToken: string;
}
```

Treat argv quoting as protection against unintended interpolation, **not** a
command sandbox. Programs may exercise the SSH account's full authority,
including explicitly invoking a shell through their arguments. There is no
automatic shell wrapping or separate script/command-string field. Arbitrary
environment, credentials, initial stdin, local shells and attachment to existing
workspace terminals are not included in v1.

Docker's domain/worker layer remains responsible for selecting `docker exec -it`
arguments, validating a running container, and checking daemon identity. The UI
only requests the action and mounts the returned offer. Do not add Docker logic
to the native broker, workspace layout, or host renderer.

## Permissions

The registered Manifest v2 capability is `ssh.terminal.open`. Do not repurpose
`ssh.command.execute` or legacy `terminal.command.execute` to implicitly grant it.

Permission authorizes requesting a session, not silently opening it. Keep the
per-session trusted user activation and confirmation separate from the persisted
permission grant. Revocation stops active sessions and invalidates pending offers.

No plugin-facing write/send or output-subscription API in the initial release.
Those would require separately reviewed permissions and native enforcement.
Container root is potentially host-root authority; Docker must explain that in
its permission reason and confirmation. No background auto-restart on reconnect.

## Surface layout and input

### Popup occlusion (SDK 2.1.0-beta.4 integration beta)

`registerTerminalOverlay(element)` registers an open plugin popup and returns
idempotent `dispose()` and `refresh()` methods. Dispose on close/unmount. It sends
only bounded rectangles through the existing document/offer/revision protocol;
there is no terminal I/O or host DOM access. At most eight popups are registered.
Resize/style/scroll observations are event-driven and coalesced per frame.

Hosts advertise `overlays: true` in the version-1 handshake. New SDKs omit the
field for old hosts and temporarily hide the surface while a popup is open,
retaining the session. New hosts subtract overlapping popup rectangles from
the surface clip path so rendering and pointer hit testing agree. Terminal size,
xterm instance and PTY dimensions stay unchanged. Overlapping holes are
subtracted as a union, not even-odd paths that expose intersections again.

Popups occlude only their actual rectangles, including over the header. The
uncovered header and output remain visible without changing terminal dimensions.
The host confirmation dialog remains the approval boundary. Host dialogs retain
priority. Closing popups restores the surface without stealing focus or opening
another session. This is axis-aligned rectangular occlusion, not arbitrary CSS
stacking or a host-rendered menu service. Packaged WebView2 validation remains
required before publishing this capability.

The terminal is rendered in a stable host-owned DOM sibling above the iframe,
clipped to the plugin pane content area. It is not a portal into iframe DOM and
does not require another workspace split. The iframe declares a rectangular
slot using CSS-pixel coordinates relative to its viewport.

- Strictly validate messages, their source window, owner, document generation,
  monotonic geometry revision and slot identity.
- Clamp the visible region to the trusted pane content allocation. Never use
  iframe-provided absolute window coordinates, CSS, transforms or z-index.
- Preserve the full terminal dimensions when partially clipped by scrolling.
  Clipping is not a PTY resize. Fully clipped surfaces are hidden.
- Coalesce slot observation/scroll/resize work per animation frame; no polling.
  Disconnect observers and cancel scheduled work on disposal.
- Slots remain axis-aligned without CSS transforms. Registered rectangular
  popups use the occlusion contract above; arbitrary DOM embedding is unsupported.
- Zync's header identifies the terminal's owner and destination. Registered
  popups may overlap it; it is not the approval boundary. The separate host
  confirmation dialog cannot be covered or styled by plugin content.
- Hide/disable terminal surfaces during host dialogs and workspace drag/resize
  hit-testing suppression. Host modals must win stacking and focus ownership.
- Hide/blur inactive surfaces and suppress resize/input work while hidden. Keep
  the running session, without stealing focus when it becomes visible again.
- Route keyboard/clipboard through the host terminal policy. Never forward raw
  terminal keys or copied output to the plugin. No automatic URL launching or
  privileged clipboard handling from untrusted terminal escape sequences.

The session manager and surface allocation are independent: later opening a
dedicated workspace terminal should reuse the session service, not modify
kind-agnostic split/dock operations. Do not reparent existing xterm/iframe DOM.

## Lifecycle and resource policy

Host owner snapshots include runtime instance, pane instance, frame generation
and connection token. They come from trusted host state, never from messages.
Launch arguments and owner snapshots are immutable across all async steps.

The coordinator reserves capacity **before** authorization or confirmation:
eight total sessions, four per runtime, one per pane initially. Opening and
closing sessions count too. These are centralized host policy defaults; native
limits must enforce the same ceilings independently. No limits depend on plugin
names or IDs.

`prepare`, `confirm`, and `create` adapters receive an `AbortSignal`. They must
settle on cancellation; a delayed creation result is always closed rather than
attached to a replacement pane. Native adapters must release unconsumed offers
on abort or denial; the native offer store also needs an independent bounded
capacity and expiry in case the webview dies. Closing is idempotent. Teardown
starts for every matching session even if one close fails. Do not release a native capacity
reservation until local channel shutdown has been confirmed.

On pane close, frame navigation/reload, runtime crash/reload, disable/uninstall,
permission revoke, connection loss/rebind, or app teardown, close the owned
channel. Native leases and lifecycle hooks must perform this even if JS cleanup
cannot run. Detach output callbacks before disposing xterm. Generation-gate
pending output/input/resize to prevent cross-session delivery.

Native output transport should reuse the binary/batched terminal machinery where
practical, with explicit backpressure and bounded buffers. Do not use Worker or
iframe `postMessage` for per-chunk PTY output. Keep scrollback bounded and start
with a DOM renderer; allocate extra WebGL contexts only after resource profiling.

Closing an SSH channel does not guarantee that daemonized remote processes are
killed. A lost connection may leave remote state unknown. Session handles,
terminal contents, commands and output are not persisted, synced or sent to
analytics. App restart must never restore an interactive plugin session silently.

## Build sequence and exit criteria

1. **Foundation — implemented:** immutable proposals, clipping geometry, host
   lifecycle/capacity coordination and race tests. No production routing changes.
2. **Native broker and engine — implemented internally:** one-use offers/approvals, manifest grants and API
   compatibility checks, pane leases, SSH PTY streaming/input/resize, bounded
   queues, timeouts and independent lifecycle teardown. Test revoke, reconnect,
   cross-pane access, replay and cancellation before exposing an API.
3. **Host surface — wired, manual validation pending:** isolated slot protocol, stable DOM xterm, theme/typography,
   focus, trusted header, clipboard, dialog stacking and visibility. Browser and
   packaged WebView2 tests for scroll, resize, split/dock, hidden panes and reload.
4. **SDK wired; Docker pending:** versioned optional surface helper and worker offer API;
   capability detection on older hosts; worker/domain validation; native session
   consumer in Docker, preserving the old confirmed command runner as fallback.
5. **Release gate:** full type/tests, native tests, SDK/package validation, mock
   transport stress tests and an authorized real-SSH smoke test. Measure output
   flood memory, input responsiveness, repeated open/close and package-mode asset
   loading. Do not promote the terminal API to stable or release a consuming
   plugin until this gate passes. A beta SDK candidate is for integration testing.

## File map and tests

| Path | Responsibility |
| --- | --- |
| `src/features/plugins/terminal/types.ts` | Host owner/transport contracts and central limits |
| `src/features/plugins/terminal/launch.ts` | Strict untrusted proposal validation and immutable snapshots |
| `src/features/plugins/terminal/sessionService.ts` | Host async lifecycle coordinator; no native authority |
| `src/features/plugins/terminal/surfaceGeometry.ts` | Slot validation and bounded visible allocation |
| `src/features/plugins/terminal/surfaceProtocol.ts` | Strict document/offer/revision geometry messages |
| `src/features/plugins/terminal/paneBridge.ts` | Mounted host pane routing for worker proposals |
| `src/features/plugins/terminal/nativeTransport.ts` | Host-only native leases, binary output credits and bounded input |
| `src/components/plugins/PluginTerminalLayer.tsx` | Trusted header, confirmation, stable xterm and observer cleanup |
| `packages/plugin-sdk/terminal.js` | Optional surface handshake, geometry observations and disposal |
| `tests/pluginTerminalIntegration.test.mjs` | SDK fallback, routing, framing and teardown regressions |
| `tests/pluginTerminalFoundation.test.mjs` | Foundation validation, geometry and lifecycle race tests |
| `src-tauri/src/plugins/terminal/mod.rs` | Host-only native commands and async broker authorization |
| `src-tauri/src/plugins/terminal/registry.rs` | Opaque document/approval ownership, expiry, capacity and teardown |
| `src-tauri/src/plugins/terminal/policy.rs` | Native request limits, output batching and acknowledgement window |
| `src-tauri/src/plugins/terminal/engine.rs` | Separate SSH PTY actor, bounded writer and late-open cleanup |

Run `npm run test:plugin-terminal-foundation`. Continue native work in a dedicated
plugin terminal module; reuse broker leases rather than copying authorization.
The existing terminal design remains documented in [TERMINAL.md](./TERMINAL.md);
workspace container behavior stays in [WORKSPACE.md](./WORKSPACE.md).

### Foundation validation (2026-09-30)

App and SDK type checks, 29 focused foundation tests, the existing agent regression
suite, and the production frontend build pass. The build still reports terminal
circular-import and bundle-size warnings in unchanged code. No packaged terminal
embedding or real-SSH test has run: the new service has no production adapter yet.

### Native transport and integration contract

Native commands are main-host IPC only, not worker or iframe RPCs. The main-window
check supplements the existing Tauri origin restrictions and isolated pane CSP;
the window label alone is not a security boundary. The host adapter must:

1. Register once per pane document generation, then freeze and prepare the argv
   proposal. Registration derives the server from the native broker pane binding.
2. Show a Zync-owned foreground confirmation for that exact proposal and server.
   Only after approval call `plugins_terminal_approve`; never forward this command
   or its returned token through worker/pane messaging.
3. Start once with the approval token and separate host-only output/event channels.
   The offer ID becomes the native terminal handle; it is not a workspace PTY ID.
4. Decode each raw output frame as a little-endian u32 sequence followed by bytes.
   Acknowledge only after xterm's write callback completes, not on IPC arrival.
   Sequences are session-local, not the existing workspace generation format.
5. Keep processing final output until the `closed` event. `exit` only reports an
   exit status; it does not dispose the renderer. Call close on aborted preparation
   or denial, and dispose the document on iframe replacement and pane teardown.

Native ceilings: eight reservations overall, four per runtime, one per pane;
64 documents and 64 pending registrations. Offers/approvals expire after 60s.
Input uses 16 queued packets of at most 4 KiB plus one in-flight write; resize
keeps only the latest 1–1000-cell dimensions. Output batches at 16 KiB/12ms, with
at most 128 KiB or 64 emitted frames awaiting acknowledgement. Invalid credits,
queue overflow, renderer failure or a 5s acknowledgement stall close the channel.
Final output is acknowledged before a normal close event, with the same deadline.

The receive queue inside russh 0.46 is unbounded. The actor continuously drains
it and fails closed rather than pausing reads for renderer backpressure; package
checks run in a separate monitor. This bounds our queues, **not all upstream SSH
memory under arbitrary floods**. Flood profiling remains a release gate.

russh also cannot cancel an unconfirmed channel-open request cleanly. The UI gets
a startup timeout after 5s, but a retained opening task closes any channel that
arrives late (including an abandoned oneshot handoff). Its reservation stays
counted until the open fails or late-channel cleanup finishes. An unresponsive
server can therefore leave that pane's capacity pending, and the library's handle
mutex can delay other operations on that connection. Test this case and resolve
the underlying library limitation before advertising robust interactive terminals.

No terminal content, input, argv or session handles enter telemetry or persistence.
Existing plugins need no changes. The SDK permission validator recognizes the
new capability. The beta.4 SDK is published for integration testing; the operator
chose to defer the pre-publish host-surface smoke test. That test remains pending.

### Host/SDK integration validation (2026-10-01)

App and SDK type checks, SDK release/package checks, the complete agent test
suite and the production frontend build pass. Eight focused integration tests
cover stale geometry, pane ownership, older-host fallback, document replacement,
output acknowledgement timing, bounded input ordering and late cleanup. Existing
build warnings remain. No packaged embedded-terminal UI smoke test or real-server
interactive/flood profile has run; the upstream russh limits below still gate
stable release. Docker has not been changed.

### Native validation (2026-09-30)

Native compilation and 118 plugin regression tests pass, including 17 terminal
tests. Two terminal tests use an ephemeral localhost SSH server to verify late
open and abandoned-handoff cleanup; the rest cover approvals, expiry, quotas,
document replacement, cancellation, framing, credits, batching and queue limits.
App and SDK type checks, SDK catalog/validator checks and the 29 host foundation
tests pass. No packaged embedded surface, end-to-end interactive command or
real-server flood/profile test has run. The feature is not release-ready yet.
