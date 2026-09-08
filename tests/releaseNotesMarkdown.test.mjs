import assert from 'node:assert/strict';
import {
  classifyMediaUrl,
  coerceHtmlBoolean,
  hasPathTraversal,
  isAllowedMediaUrl,
  isGithubAttachmentUrl,
  isLocalMediaPath,
  rewriteLocalMediaSrc,
  rewriteMarkdownLocalMedia,
  toFilesystemPath,
} from '../.tmp-agent-tests/src/lib/releaseNotes/mediaUrls.js';
import { matchAlertPrefix, stripAlertPrefixFromParts } from '../.tmp-agent-tests/src/lib/releaseNotes/alerts.js';
import { extractToc, slugify } from '../.tmp-agent-tests/src/lib/releaseNotes/headings.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('allows GitHub user-attachment HTTPS media', () => {
  const url = 'https://github.com/user-attachments/assets/fd7731ff-3517-4b69-923c-e7ab79fe9e12';
  assert.equal(isAllowedMediaUrl(url), true);
  assert.equal(isGithubAttachmentUrl(url), true);
  assert.equal(classifyMediaUrl(url), 'unknown');
});

runTest('classifies gif and mp4 by extension', () => {
  assert.equal(
    classifyMediaUrl('https://user-images.githubusercontent.com/1/demo.gif'),
    'image',
  );
  assert.equal(
    classifyMediaUrl('https://user-images.githubusercontent.com/1/demo.mp4'),
    'video',
  );
  assert.equal(
    classifyMediaUrl('https://user-images.githubusercontent.com/1/demo.webm'),
    'video',
  );
});

runTest('rejects javascript, data, and non-media URLs', () => {
  assert.equal(isAllowedMediaUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedMediaUrl('data:image/png;base64,aaaa'), false);
  assert.equal(isAllowedMediaUrl('https://evil.example/not-media'), false);
  assert.equal(isAllowedMediaUrl('http://github.com/user-attachments/assets/abc'), false);
  assert.equal(isAllowedMediaUrl('shot.png'), false);
  assert.equal(isAllowedMediaUrl('./local.png'), false);
});

runTest('allows https CDN media and embeds a bare Demo GIF URL', () => {
  const gif = 'https://pub-f5d307b0347348988dccc997da10756a.r2.dev/export-1788007096421.gif';
  assert.equal(isAllowedMediaUrl(gif), true);
  assert.equal(classifyMediaUrl(gif), 'image');
  const out = rewriteMarkdownLocalMedia(`## Demo\n\n${gif}\n`);
  assert.match(out, /!\[\]\(https:\/\/pub-f5d307b0347348988dccc997da10756a\.r2\.dev\/export-1788007096421\.gif\)/);
});

runTest('allows absolute local image paths and rejects traversal', () => {
  const winPath = 'C:\\Users\\gajen\\AppData\\Local\\Temp\\waveterm-3125566605\\waveterm_paste_1788887604406_wsbwrk.png';
  assert.equal(isLocalMediaPath(winPath), true);
  assert.equal(isAllowedMediaUrl(winPath), true);
  assert.equal(classifyMediaUrl(winPath), 'image');
  const fileUrl = rewriteLocalMediaSrc(winPath);
  assert.ok(fileUrl && fileUrl.startsWith('file:'));
  assert.equal(toFilesystemPath(fileUrl).toLowerCase().endsWith('wsbwrk.png'), true);
  assert.equal(isAllowedMediaUrl('/tmp/demo.gif'), true);
  assert.equal(isAllowedMediaUrl('C:\\Windows\\notepad.exe'), false);
  assert.equal(isAllowedMediaUrl('C:\\Users\\gajen\\..\\secret.png'), false);
  assert.equal(hasPathTraversal('C:\\Users\\gajen\\..\\secret.png'), true);
  assert.equal(hasPathTraversal('file:///C:/Users/%2e%2e/secret.png'), true);
  assert.equal(hasPathTraversal('file:///C:/Users/gajen/shot.png'), false);
});

runTest('stripAlertPrefixFromParts keeps later markup nodes', () => {
  const kept = stripAlertPrefixFromParts(['[!NOTE] See the ', { href: '/docs' }, ' and `code`']);
  assert.deepEqual(kept, ['See the ', { href: '/docs' }, ' and `code`']);
  assert.deepEqual(stripAlertPrefixFromParts(['[!TIP]', { href: '/x' }]), [{ href: '/x' }]);
});

runTest('rewriteMarkdownLocalMedia embeds a bare Windows paste path', () => {
  const winPath = 'C:\\Users\\gajen\\AppData\\Local\\Temp\\waveterm-3125566605\\waveterm_paste_1788887604406_wsbwrk.png';
  const out = rewriteMarkdownLocalMedia(`See this:\n\n${winPath}\n`);
  assert.match(out, /!\[\]\(<file:\/\/\/C:\/Users\/gajen\/AppData\/Local\/Temp\/waveterm-3125566605\/waveterm_paste_1788887604406_wsbwrk.png>\)/);
});

runTest('rewriteMarkdownLocalMedia rewrites ![](C:\\…) before parse', () => {
  const out = rewriteMarkdownLocalMedia('![paste](C:\\Temp\\shot.gif)');
  assert.equal(out, '![paste](<file:///C:/Temp/shot.gif>)');
});

runTest('rewriteMarkdownLocalMedia leaves fenced paths alone', () => {
  const fenced = '```\nC:\\Temp\\shot.png\n```';
  assert.equal(rewriteMarkdownLocalMedia(fenced), fenced);
});

runTest('allows githubusercontent subdomains and shields badges', () => {
  assert.equal(isAllowedMediaUrl('https://raw.githubusercontent.com/zync-sh/zync/main/shot.png'), true);
  assert.equal(isAllowedMediaUrl('https://img.shields.io/badge/x-y.svg'), true);
  assert.equal(
    isAllowedMediaUrl('https://private-user-images.githubusercontent.com/1/2.jpg?jwt=abc'),
    true,
  );
});

runTest('coerceHtmlBoolean treats HTML boolean attributes as true', () => {
  assert.equal(coerceHtmlBoolean(true), true);
  assert.equal(coerceHtmlBoolean(''), true);
  assert.equal(coerceHtmlBoolean('true'), true);
  assert.equal(coerceHtmlBoolean('loop'), true);
  assert.equal(coerceHtmlBoolean(false), false);
  assert.equal(coerceHtmlBoolean(undefined), false);
});

runTest('matchAlertPrefix parses GitHub alert markers', () => {
  assert.deepEqual(matchAlertPrefix('[!NOTE]\nHello'), { kind: 'note', rest: 'Hello' });
  assert.deepEqual(matchAlertPrefix('[!WARNING] Careful'), { kind: 'warning', rest: 'Careful' });
  assert.equal(matchAlertPrefix('just a quote'), null);
});

runTest('extractToc skips headings inside fences and images', () => {
  const toc = extractToc(`
# Title

\`\`\`
# not a heading
\`\`\`

## Added

![Nested splits](https://github.com/user-attachments/assets/abc)

### Pane focus
`);
  assert.deepEqual(toc.map((e) => e.text), ['Title', 'Added', 'Pane focus']);
});

runTest('slugify uniquifies duplicate headings', () => {
  const used = new Map();
  assert.equal(slugify('Added', used), 'added');
  assert.equal(slugify('Added', used), 'added-1');
});
