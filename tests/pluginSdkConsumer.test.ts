import { defineManifest, type ManifestV2 } from '@zync-sh/plugin-sdk';
import type { ZyncWorkerApi } from '@zync-sh/plugin-sdk/worker';
import type { ZyncPaneApi } from '@zync-sh/plugin-sdk/pane';
import { mountTerminalSurface } from '@zync-sh/plugin-sdk/terminal';
import { validateManifest } from '@zync-sh/plugin-sdk/validate';

/** Compile-time contract for the published SDK version pinned by Zync. */
const manifest: ManifestV2 = defineManifest({
  manifestVersion: 2,
  id: 'com.example.host-contract',
  name: 'Host contract',
  version: '1.0.0',
  publisher: 'com.example',
  engines: { zync: '>=2.32.2', pluginApi: '^2.1.0' },
  runtime: { entry: 'worker.js' },
  permissions: { required: [] },
});

declare const worker: ZyncWorkerApi;
declare const pane: ZyncPaneApi;

worker.sshCommand.execute('pane', { program: 'true', args: [] });
pane.pane.onMessage(message => pane.pane.postMessage(message));
validateManifest(manifest);
const surface = mountTerminalSurface(document.createElement('div'), 'offer');
surface.dispose();
