import assert from 'node:assert/strict';
import {
  extractFileManagerDropPaths,
  formatFilePathsForTerminal,
  isFileManagerPathDrag,
  quotePosixShellArg,
  quoteWindowsShellArg,
} from '../.tmp-agent-tests/src/lib/terminal/fileDropToTerminal.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

function dataTransfer(map) {
  return {
    getData(type) {
      return map[type] || '';
    },
  };
}

runTest('quotePosixShellArg leaves plain tokens unquoted', () => {
  assert.equal(quotePosixShellArg('/home/user/file.txt'), '/home/user/file.txt');
  assert.equal(quotePosixShellArg("it's"), `'it'\\''s'`);
  assert.equal(quotePosixShellArg('a b'), `'a b'`);
  assert.equal(quotePosixShellArg(''), "''");
});

runTest('quoteWindowsShellArg doubles inner quotes', () => {
  assert.equal(quoteWindowsShellArg('C:\\Users\\a.txt'), 'C:\\Users\\a.txt');
  assert.equal(quoteWindowsShellArg('C:\\My Docs\\a.txt'), '"C:\\My Docs\\a.txt"');
  assert.equal(quoteWindowsShellArg('say "hi"'), '"say ""hi"""');
});

runTest('formatFilePathsForTerminal joins quoted paths with a trailing space', () => {
  assert.equal(formatFilePathsForTerminal(['/tmp/a', '/tmp/b c'], false), `/tmp/a '/tmp/b c' `);
  assert.equal(formatFilePathsForTerminal(['C:\\a b'], true), '"C:\\a b" ');
  assert.equal(formatFilePathsForTerminal([], false), '');
});

runTest('extractFileManagerDropPaths reads server-file JSON first', () => {
  const dt = dataTransfer({
    'application/json': JSON.stringify({
      type: 'server-file',
      path: '/one',
      paths: ['/one', '/two'],
    }),
    'text/plain': '/ignored',
  });
  assert.deepEqual(extractFileManagerDropPaths(dt), ['/one', '/two']);
});

runTest('extractFileManagerDropPaths falls back to text/plain lines', () => {
  const dt = dataTransfer({ 'text/plain': '/a\n /b \n' });
  assert.deepEqual(extractFileManagerDropPaths(dt), ['/a', '/b']);
});

runTest('extractFileManagerDropPaths uses fallback only when DataTransfer is empty', () => {
  const empty = dataTransfer({});
  assert.deepEqual(extractFileManagerDropPaths(empty, ['/held', '/also']), ['/held', '/also']);
  const dt = dataTransfer({ 'text/plain': '/from-dt' });
  assert.deepEqual(extractFileManagerDropPaths(dt, ['/held']), ['/from-dt']);
});

runTest('isFileManagerPathDrag accepts json or plain text', () => {
  assert.equal(isFileManagerPathDrag(['application/json']), true);
  assert.equal(isFileManagerPathDrag(['text/plain']), true);
  assert.equal(isFileManagerPathDrag(['Files']), false);
});

console.log('fileDropToTerminal tests passed.');
