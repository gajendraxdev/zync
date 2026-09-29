import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paneAssetMimeTypes, validatePackageDirectory } from '@zync-sh/plugin-sdk/validate';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewShim = `window.zync = Object.freeze({pane: Object.freeze({
  postMessage() { console.info('[Zync preview] Worker unavailable. Test actions inside Zync.'); },
  onMessage() { return () => {}; },
  isVisible() { return true; },
  onVisibilityChange(callback) { callback(true); return () => {}; }
})});`;
const previewCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function packageFile(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes(':') || decoded.includes('\0')) return null;
  const target = path.resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const canonical = fs.realpathSync(target);
    if (!canonical.startsWith(`${root}${path.sep}`)) return null;
    return { target, size: stat.size };
  } catch { return null; }
}

/** Visual-only preview; the real pane bridge and permission checks live in Zync. */
export async function startPreview(root = path.join(project, 'dist')) {
  const packageRoot = fs.realpathSync(root);
  const validation = validatePackageDirectory(packageRoot);
  if (!validation.valid) throw new Error(`Build a valid plugin first: ${validation.issues.map(issue => issue.message).join('; ')}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'manifest.json'), 'utf8'));
  const entry = manifest.contributes?.paneKinds?.[0]?.entry;
  if (!entry) throw new Error('The plugin has no pane to preview');
  const entryPath = `/${entry.split('/').map(encodeURIComponent).join('/')}`;
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/') {
      response.writeHead(302, { Location: entryPath }).end();
      return;
    }
    if (pathname === '/__zync_preview_shim.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : previewShim);
      return;
    }
    const asset = packageFile(packageRoot, pathname);
    const isDocument = pathname === entryPath;
    const contentType = isDocument ? 'text/html; charset=utf-8' : paneAssetMimeTypes[path.extname(pathname).toLowerCase()];
    if (!asset || !contentType || asset.size > (isDocument ? 512 * 1024 : 2 * 1024 * 1024)) {
      response.writeHead(404).end();
      return;
    }
    let content = fs.readFileSync(asset.target);
    if (isDocument) {
      const html = content.toString('utf8');
      const shim = '<script src="/__zync_preview_shim.js"></script>';
      const doctype = /^(?:\uFEFF)?(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(html);
      const withoutHead = doctype
        ? `${doctype[0]}${shim}${html.slice(doctype[0].length)}`
        : `${shim}${html}`;
      content = Buffer.from(/<head(?:\s[^>]*)?>/i.test(html)
        ? html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${shim}`)
        : withoutHead);
      response.setHeader('Content-Security-Policy', previewCsp);
    }
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(request.method === 'HEAD' ? undefined : content);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startPreview();
    console.log(`Visual-only pane preview: http://127.0.0.1:${server.address().port}/`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
