# SDK release policy

## 2.1.0-beta.4 — terminal overlay integration

Published under `beta` on 2026-10-01. Registry integrity matches the reviewed
tarball (`a26c681030638589d8c4ac37bf7c3ab1a57ed1ba` SHA-1); `latest` remains
`2.0.0-beta.1`. SDK release checks, the full agent suite, 118 native plugin
tests and the stable/beta example registry check passed; the clean local
tarball installation exposed both terminal helpers and had no audited vulnerabilities.

Adds `registerTerminalOverlay` with frame-coalesced geometry, bounded popup
registration and deterministic cleanup. Compatible hosts clip actual popup bounds
without moving or resizing terminals; older hosts retain the session and hide
the surface while a popup is open. Existing exports remain compatible.
The operator tested the packaged host and reported working dropdowns, copy and
terminal rendering. One WebView2 renderer crash was observed and did not recur;
its cause remains unresolved. This remains an integration beta, not stable promotion.

The npm package version and the Zync plugin API version are separate. `@zync-sh/plugin-sdk` may release documentation, types, or tooling fixes without changing the host API. A breaking host API requires a new `engines.pluginApi` major version and matching native/SDK support. Plugin packages continue to declare their own `version`, `engines.zync`, and `engines.pluginApi` ranges.

Manifest v2 engine ranges use semantic-version comparators such as `^2.0.0`, `>=2.32.2`, or `>=2.32.2, <3.0.0`. Avoid npm-only unions (`||`) and hyphen ranges; the native host is authoritative. Pre-release host versions require a matching pre-release comparator. When a plugin's engine range does not match the running host, Zync rejects install/activation or skips loading the installed plugin. A rollback to an incompatible retained version is rejected before replacing the active package.

Before a beta npm SDK release:

The starter now uses package-relative pane CSS and JavaScript. An integration-
only SDK beta may precede the desktop release so plugin authors can prepare
their sources. Keep `externalPaneAssetsMinZyncVersion` conservative and verify
it against the first **published** desktop build with the isolated resource
route before releasing migrated plugins to users. Do not offer the new starter
to older Zync versions; previously signed inline-pane packages remain untouched.

1. Run `npm run sdk:release-check` from the Zync repository root. It checks type contracts, validator cases, the starter build, and the exact npm package contents.
2. Run the native plugin tests and the full agent regression suite.
3. Run `node check.mjs` in the sibling `zync-plugin-channel-examples` project to validate, sign, and verify stable and beta builds in a disposable registry.
4. Review the exact SDK tarball, production dependency audit, license, and documentation. Publish the prerelease with the `beta` npm tag and install it in a clean project to verify the CLI and exported types. Check the actual registry tags after publishing; npm initialized `latest` to the beta on this package's first release despite `--tag beta` and rejected removal of `latest`. Do not describe `latest` as stable until a stable release replaces that tag.

`@zync-sh/plugin-sdk@2.0.0-beta.1` was published under `beta` on 2026-09-25. A clean npm install verified the CLI and exported runtime helpers. npm also currently resolves `latest` to this first beta; install `@beta` explicitly until stable promotion.

`@zync-sh/plugin-sdk@2.1.0-beta.2` was published under `beta` on 2026-09-29 for plugin integration testing. The SDK release checks, native plugin tests, app agent regression suite, example registry signing check, and production dependency audit passed. A clean install validated a sample plugin with the published CLI. The `latest` tag remains at `2.0.0-beta.1`. External pane assets still require a packaged Zync desktop release that supports the isolated resource route; do not distribute migrated plugin builds to older hosts.

The SDK beta is an authoring tool, not a production marketplace launch. Before promoting it to `latest` or calling the marketplace production-ready, deploy the signed test builds to a protected HTTPS staging registry. Manually verify marketplace listing, opt-in beta update, switch back to stable, permission review, and retained-version rollback in the desktop app. Record the tested Zync build, SDK version, registry version, and package digests; complete the external-plugin smoke test and independent security review. Local signing tests do not substitute for these checks.

The automatic checks are not a security audit. Do not publish the package merely because they pass.

## 2.1.0-beta.3 — published for integration testing

Published under `beta` on 2026-10-01 after automatic SDK checks passed. Registry
integrity matches the reviewed local tarball; `latest` remains `2.0.0-beta.1`.
The operator explicitly chose to publish this integration beta before the
host-surface smoke test. That test and the stable-release gates remain pending;
publication does not certify the embedded terminal for production use.

Adds optional worker `sshTerminal.context/prepare` authoring types and the bundled
`@zync-sh/plugin-sdk/terminal` geometry helper. Existing exports and legacy host
terminal APIs are unchanged. Older hosts must use the confirmed command-runner
fallback. This candidate is for integration with the updated desktop checkout;
it is not compatible with older desktop builds merely because plugin API 2.1
matches. Test capability detection and the actual desktop build before rollout.

Automatic SDK checks include host/surface transport regressions and the exact npm
file inventory. Local packing is not publishing. Before a beta publish, review
the pending changes and smoke-test the host-owned surface; before stable promotion,
complete packaged desktop and real-SSH lifecycle/flood tests and resolve the native
channel-open/cancellation limitation recorded in `docs/PLUGIN_TERMINALS.md`.
