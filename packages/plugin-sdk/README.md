# Zync plugin SDK (beta)

Public authoring types for Manifest v2 plugins. This package lives in the Zync repository but has its own npm version and release lifecycle.

The published SDK targets API **2.1** (`2.1.0-beta.1`). It adds `sshCommand.execute(paneInstanceId, { program, args, expectedConnectionToken? })`, requiring `ssh.command.execute` and `engines.pluginApi: "^2.1.0"`. The returned `connectionToken` must be carried into commands following a confirmation so reconnect/rebind cannot silently change their destination. Commands use the SSH account's full authority; this is not a read-only or PM2-only permission. API 2.0 hosts reject plugins requiring this addition.

To test unpublished CLI additions, install the local SDK as a development dependency:

```sh
npm install --save-dev /path/to/zync/packages/plugin-sdk
```

The published `@beta` release is currently **2.1.0-beta.1** and includes the 2.1 SSH command API. Install it with:

```sh
npm install --save-dev @zync-sh/plugin-sdk@beta
```

Zync supplies the `zync` object when it starts a plugin worker or pane. Do not bundle an SDK runtime into the plugin.

## Editor status (desktop host)

Editor-provider iframes receive a separate `zyncEditor` bridge. After `zync:editor:open-document`, a provider can report its one-based cursor position and optional short language label to Zync's bottom status bar:

```ts
import type { ZyncEditorBridge } from '@zync-sh/plugin-sdk/editor';

declare const zyncEditor: ZyncEditorBridge;

zyncEditor.reportStatus({ docId: currentDocument.docId, line: 12, column: 4, language: 'typescript' });
```

Report on cursor or selection changes, not on a timer. The `docId` must match the current document; stale, invalid, or oversized values are ignored. Zync supplies the filename, encoding, and modified state itself. Older desktop hosts ignore this optional message. This declaration is available in this source checkout; do not assume it exists in a previously published SDK package until that package has been released.

## Manifest

`defineManifest` gives TypeScript a Manifest v2 contract and returns the same object. It does **not** validate a package or grant permissions; the Zync host is the final authority.

```ts
import { defineManifest } from '@zync-sh/plugin-sdk';

export default defineManifest({
  manifestVersion: 2,
  id: 'com.example.hello',
  name: 'Hello',
  version: '1.0.0',
  publisher: 'com.example',
  engines: { zync: '>=2.32.2', pluginApi: '^2.0.0' },
  runtime: { entry: 'worker.js' },
  contributes: {
    commands: [{ id: 'hello.say-hi', title: 'Say hi' }],
  },
  permissions: {
    required: [{ id: 'ui.commands.register', reason: 'Add the command to Zync.' }],
  },
});
```

Write the resulting object to `manifest.json` during your build. Zync installs the JSON and the built plugin files, not the TypeScript source.

## Validate before signing

### Generate a publisher key using OpenSSL

The published `2.1.0-beta.1` package does not include `keygen` or the `zync-sdk` executable. These are implemented locally and require a new SDK version published and tagged `beta`. After that release, use the official scoped package explicitly:

```powershell
npx --package=@zync-sh/plugin-sdk@beta zync-sdk keygen --out C:\ZyncSigningKeys\publisher-v1
```

Do not use `npx zync-sdk`: that can resolve an unrelated unscoped npm package. In a project with this SDK installed, `npx --no-install zync-sdk keygen --out <new-directory>` runs its installed executable. Before publication, developers working in this source checkout can test it with `node packages/plugin-sdk/bin/zync-plugin.mjs keygen --out <new-directory>`.

Install OpenSSL first, or supply `--openssl <executable-path>`. Git for Windows' bundled OpenSSL is detected automatically. The command invokes OpenSSL directly without a shell; Node.js does not generate keys. The SDK prompts with hidden input: **press Enter to skip encryption**, or enter and confirm a passphrase to encrypt the private key. Nonempty passphrases go to OpenSSL through stdin, never command arguments. Use a long unique passphrase and keep it in your password manager. An interactive terminal is required; Ctrl+C cancels. Passphrases briefly exist in process memory.

Choose encrypted, non-synced storage outside Git. The parent directory must exist; the output directory must not exist. The command writes a PKCS#8 Ed25519 `publisher-private.pem` (AES-256-CBC encrypted if you enter a passphrase) and a public `publisher-public.pem`; only the public file may be shared. Skipping encryption prints a warning: anyone who copies the private file can sign as you. Unix permissions are restricted; Windows users must also ensure suitable folder access permissions. Keep encrypted backups. A failed command stops immediately and may leave partial output, which must not be used.

This command is for plugin publishers, not marketplace root-key management. Generating a key does not register a publisher or publish a plugin. Sign the built directory, then verify it independently:

Publishers choose their key-custody model, including local signing or protected CI secrets. Never commit private keys, include them in packages, print them in logs, or send them to the marketplace. Keep signing secrets out of PR-validation jobs and untrusted code execution. Protected release environments, reviewed dependencies and restricted secret access are recommended; passphrase encryption is optional. The marketplace root key has a separate operator policy and must not be substituted for a publisher key.

```powershell
npx --package=@zync-sh/plugin-sdk@beta zync-sdk sign --source ./dist/my-plugin --key C:\ZyncSigningKeys\publisher-v1\publisher-private.pem --out ./signed/my-plugin
npx --package=@zync-sh/plugin-sdk@beta zync-sdk verify --source ./signed/my-plugin
```

These commands belong to the same unpublished SDK update. The signer accepts Ed25519 private PEM keys (encrypted or unencrypted) and existing JSON publisher keys. Encrypted PEM keys prompt once using hidden input. The PEM publisher identity comes from the manifest; trusted marketplace metadata must separately authorize that public key for the publisher. Verification checks package integrity and its signature, not publisher authorization, behavior safety, or registry trust. Signed output must be new and outside the source directory; the private key must also be outside the source. Never include private keys in build output. Keep the signed folder's contents at the ZIP root, including `integrity.json` and `signature.json`.

Run the packaged CLI against the **built plugin directory** (the one containing `manifest.json` and its referenced assets):

```sh
npx zync-plugin validate ./dist/my-plugin --zync-version 2.32.2
```

In this repository, the same check is available as `npm run plugin:validate -- ./dist/my-plugin`. For programmatic checks, import `validateManifest` or `validatePackageDirectory` from `@zync-sh/plugin-sdk/validate`. Validation returns `{ valid, issues }`; warnings do not fail the check.

The preflight checks Manifest v2 fields, publisher namespace, semantic plugin version, contribution/permission declarations, known permissions, network host declarations, referenced files, basic package limits, and plugin API compatibility. For static pane resource links it also checks package-relative paths, supported asset types, the 2 MiB resource limit, and a minimum Zync version for external pane assets. Use relative bundler output (for example, Vite `base: './'`); root-relative URLs cannot resolve inside a plugin pane. Pass `--zync-version` to check compatibility with a specific app build; without it, the Zync range is syntax-checked only. Unknown optional permissions produce warnings because the host denies them until supported. The preflight does **not** validate signatures, inspect executable behavior, or replace native install-time validation. The signing tool and native host retain their own package and security checks.

The [basic starter template](templates/basic/README.md) is included in this package. It builds a minimal worker and isolated pane with external CSS/JavaScript, validates the output, and offers a localhost visual preview. The preview does not simulate Worker actions or permissions. See [RELEASE.md](RELEASE.md) for versioning and the publication checklist.

## Host-provided APIs

For a worker:

```ts
import type { ZyncWorkerApi } from '@zync-sh/plugin-sdk/worker';

declare const zync: ZyncWorkerApi;

zync.on('ready', async () => {
  await zync.commands.register('hello.say-hi', 'Say hi', async () => {
    await zync.ui.notify({ message: 'Hello from the plugin' });
  });
});
```

For an isolated pane, use `import type { ZyncPaneApi } from '@zync-sh/plugin-sdk/pane'` and declare `window.zync` with that type in your pane source. Panes can exchange messages with their worker; they do not get the worker API, host DOM, or direct network access.

The typed worker interface covers the Manifest v2 broker APIs only. Legacy plugin APIs are deliberately absent. Every host operation is still checked against the installed manifest, current grant, runtime identity, and applicable scope. The SDK version does not replace the manifest's `engines.pluginApi` compatibility declaration.

See the [plugin architecture](https://github.com/zync-sh/zync/blob/main/docs/PLUGINS.md) and [basic starter template](templates/basic/README.md) for package format, permissions, signing, and manual testing.
