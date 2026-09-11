import assert from 'node:assert/strict';
import {
  extractFileManagerDropPaths,
  fileDropShellKind,
  formatFilePathsForTerminal,
  isFileManagerPathDrag,
  quoteCmdExeArg,
  quotePosixShellArg,
  quotePowerShellArg,
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

runTest('quotePowerShellArg single-quotes and doubles apostrophes', () => {
  assert.equal(quotePowerShellArg('C:\\Users\\a.txt'), `'C:\\Users\\a.txt'`);
  assert.equal(quotePowerShellArg("it's"), `'it''s'`);
  assert.equal(quotePowerShellArg('$(calc)'), `'$(calc)'`);
  assert.equal(quotePowerShellArg('$env:SECRET'), `'$env:SECRET'`);
});

runTest('quoteCmdExeArg breaks percent and delayed-expansion variables', () => {
  assert.equal(quoteCmdExeArg('C:\\Users\\a.txt'), '"C:\\Users\\a.txt"');
  assert.equal(quoteCmdExeArg('%PATH%'), '"%^PATH%^"');
  assert.equal(quoteCmdExeArg('!VAR!'), '"!^VAR!^"');
  assert.equal(quoteCmdExeArg('say "hi"'), '"say ""hi"""');
  assert.equal(quoteCmdExeArg('a$(b)'), '"a$(b)"');
});

runTest('fileDropShellKind maps local Windows shells', () => {
  assert.equal(fileDropShellKind({ localWindows: false, shellId: 'cmd' }), 'posix');
  assert.equal(fileDropShellKind({ localWindows: true, shellId: 'cmd' }), 'cmd');
  assert.equal(fileDropShellKind({ localWindows: true, shellId: 'C:\\Windows\\System32\\cmd.exe' }), 'cmd');
  assert.equal(fileDropShellKind({ localWindows: true, shellId: 'powershell' }), 'powershell');
  assert.equal(fileDropShellKind({ localWindows: true, shellId: 'pwsh' }), 'powershell');
  assert.equal(fileDropShellKind({ localWindows: true, shellId: 'default' }), 'powershell');
  assert.equal(fileDropShellKind({ localWindows: true, shellId: 'wsl' }), 'posix');
  assert.equal(fileDropShellKind({ localWindows: true, shellId: 'bash' }), 'posix');
});

runTest('formatFilePathsForTerminal joins quoted paths with a trailing space', () => {
  assert.equal(formatFilePathsForTerminal(['/tmp/a', '/tmp/b c'], 'posix'), `/tmp/a '/tmp/b c' `);
  assert.equal(formatFilePathsForTerminal(['C:\\a b'], 'powershell'), `'C:\\a b' `);
  assert.equal(formatFilePathsForTerminal(['%PATH%'], 'cmd'), '"%^PATH%^" ');
  assert.equal(formatFilePathsForTerminal([], 'posix'), '');
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

runTest('extractFileManagerDropPaths preserves whitespace in text/plain lines', () => {
  const dt = dataTransfer({ 'text/plain': '/a\n /b \n' });
  assert.deepEqual(extractFileManagerDropPaths(dt), ['/a', ' /b ']);
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
