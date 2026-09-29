import { defineManifest } from '@zync-sh/plugin-sdk';
import { externalPaneAssetsMinZyncVersion } from '@zync-sh/plugin-sdk/validate';

export default defineManifest({
  manifestVersion: 2,
  id: 'dev.example.starter',
  name: 'Starter Pane',
  version: '1.0.0',
  publisher: 'dev.example',
  description: 'A minimal isolated Zync pane.',
  engines: { zync: `>=${externalPaneAssetsMinZyncVersion}`, pluginApi: '^2.0.0' },
  runtime: { entry: 'worker.js' },
  contributes: {
    paneKinds: [{ id: 'starter.main', title: 'Starter Pane', entry: 'ui/index.html', allowMultiple: true }],
  },
  permissions: {
    required: [{ id: 'ui.pane.register', reason: 'Add the starter pane to the workspace.' }],
  },
});
