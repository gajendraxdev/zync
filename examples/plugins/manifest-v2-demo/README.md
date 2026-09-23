# Manifest v2 demo plugin

This is a deliberately small, unpacked plugin for exercising Zync's local manifest-v2 installation path.

## Test it in Zync

1. Open **Settings → Plugins → Developer**.
2. Choose **Install plugin folder**.
3. Select this `manifest-v2-demo` directory.
4. Review the required permissions. Leave optional permissions off for the first run.
5. Confirm that **Manifest v2 Demo** v1.4.0 appears in the Installed list and is enabled.
6. Open its pane twice and verify each pane keeps an independent counter.
7. Open the command palette and run **Manifest v2 Demo: Say hello**. The counter is stored even though no notification appears yet.
8. Open **Details and permissions**, enable **Show notifications**, apply the change, and run the command again.
9. Select **Test approved confirmation** while its permission is off and confirm that no dialog opens. Enable **Show confirmation dialogs**, retry, and verify Zync—not the plugin pane—renders the dialog.
10. Enable **Connect to approved websites**, apply the change, and select **Test approved network** in the pane. The request must go through Zync's native broker to `api.github.com`.
11. Disable the network permission and verify the same pane action is denied.
12. Enable **Read selected files**, then use **Read selected text file** and **List selected folder**. The plugin receives an opaque handle and display name, never the selected path.
13. Disable the file permission and verify both actions are denied before a picker opens.
14. Enable **Change selected files**, choose **Create test text file**, and select an exact destination. Zync writes through a write-only opaque handle using atomic replacement.
15. Disable the write permission and verify the save picker no longer opens.
16. Enable **Read files on pane servers**, open the plugin in a connected SSH workspace, and select **List this server's home**. It must list the server home without opening a local picker. The same action in a local workspace must be denied.

The package digest is bound to its approval. Reinstall this folder after changing any example file so Zync can review the new package contents.

## Test the signed-package flow

Keep the publisher key outside the plugin directory. From the `zync` repository root:

```powershell
npm run plugin:keygen -- --publisher dev.zync.examples --out "$env:USERPROFILE\\.zync-demo-publisher-key.json"
npm run plugin:sign -- --source examples/plugins/manifest-v2-demo --key "$env:USERPROFILE\\.zync-demo-publisher-key.json" --out "$env:TEMP\\zync-manifest-v2-demo-signed"
npm run plugin:verify -- --source "$env:TEMP\\zync-manifest-v2-demo-signed"
```

In Zync, open **Settings → Plugins → Developer**, choose **Install folder**, and select the generated `zync-manifest-v2-demo-signed` directory. The review should show **Signed package** and its signing-key fingerprint, with a warning that the local signing key is not yet registry verified.

To test tamper detection, change `worker.js` inside the generated signed directory and choose it again. Inspection must fail instead of offering installation. Delete the generated output directory before signing it again; the tool never overwrites an existing package.
