# Starter Zync plugin

Copy this directory into a new project and replace the sample publisher, id, and name in `manifest.mjs` before distributing it.

Install the prerelease SDK:

```sh
npm install --save-dev @zync-sh/plugin-sdk@beta
```

For an unreleased local checkout, install it by path instead:

```sh
npm install --save-dev /path/to/zync/packages/plugin-sdk
```

Then run `npm run validate`. That builds `dist/` and checks the manifest, referenced files, permissions, and package limits. The starter emits separate `ui/pane.css` and `ui/pane.js` and declares the first planned Zync version with package-relative pane assets. Older Zync versions reject it; previously built inline-only plugins remain compatible. Before publishing a plugin, confirm its `engines.zync` range against the actual shipped Zync version.

Run `npm run preview` for a localhost, visual-only preview of the built pane. It serves the same relative files but does not run the plugin Worker or grant host permissions. Test messages and actions by installing the built plugin in Zync.

To test in a compatible Zync build, enable Developer Mode and install the `dist/` folder. Its pane should answer **Ask the Worker**. The pane cannot access the Worker API directly; messages go through Zync's bounded pane channel.

To sign a release, keep your publisher key outside the project and pass the validated `dist/` folder to Zync's signing tool. Do not publish the SDK, source files, keys, or `node_modules` as part of the plugin package.
