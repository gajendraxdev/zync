import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Loads the pinned npm SDK's signing helpers for Zync's operator-only tools.
 * SDK beta.4 packages these modules but does not expose public subpaths for
 * them; keeping the bridge here avoids coupling each caller to that layout.
 */
export const sdkPackageRoot = path.dirname(fileURLToPath(import.meta.resolve('@zync-sh/plugin-sdk')));

const loadSdkModule = relativePath => import(pathToFileURL(path.join(sdkPackageRoot, relativePath)).href);

const [signing, pemKey, keygen] = await Promise.all([
  loadSdkModule('signing.js'),
  loadSdkModule('bin/pem-key.mjs'),
  loadSdkModule('bin/keygen.mjs'),
]);

export const { generatePublisherKey, signPluginDirectory, verifySignedPlugin } = signing;
export const { readKeyText, readPemKey } = pemKey;
export const { generateKeys, readHiddenPassphrase } = keygen;
