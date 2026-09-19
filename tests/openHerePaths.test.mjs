import assert from 'node:assert/strict';
import { directoryFromFileLocation, expandTildeWithHome, isUnconfirmedHomeToken, isUnresolvedFilesPath, parentDirectory, pickFilesHomePath, pickFilesOpenPath } from '../.tmp-agent-tests/src/components/layout/tabDock/openHerePaths.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('pickFilesHomePath keeps a root home and drops ~', () => {
  assert.equal(pickFilesHomePath({ homePath: '/home/appserver' }), '/home/appserver');
  assert.equal(pickFilesHomePath({ homePath: 'C:\\Users\\gajen' }), 'C:\\Users\\gajen');
  assert.equal(pickFilesHomePath({ homePath: '/' }), '/');
  assert.equal(pickFilesHomePath({ homePath: '~' }), '');
  assert.equal(pickFilesHomePath({ homePath: '' }), '');
  assert.equal(pickFilesHomePath({}), '');
});

runTest('isUnconfirmedHomeToken treats ~ as unconfirmed but keeps /', () => {
  assert.equal(isUnconfirmedHomeToken(''), true);
  assert.equal(isUnconfirmedHomeToken('~'), true);
  assert.equal(isUnconfirmedHomeToken('/'), false);
  assert.equal(isUnconfirmedHomeToken('/home/appserver'), false);
});

runTest('pickFilesOpenPath prefers shell cwd and ignores placeholder home /', () => {
  assert.equal(pickFilesOpenPath({ lastKnownCwd: '/home/appserver' }), '/home/appserver');
  assert.equal(pickFilesOpenPath({ lastKnownCwd: '/' }), '/');
  assert.equal(pickFilesOpenPath({ lastKnownCwd: '~', homePath: '/home/appserver' }), '/home/appserver');
  assert.equal(pickFilesOpenPath({ initialPath: '/opt/app' }), '/opt/app');
  assert.equal(pickFilesOpenPath({ homePath: '/home/appserver' }), '/home/appserver');
  assert.equal(pickFilesOpenPath({ homePath: '/' }), '');
  assert.equal(pickFilesOpenPath({ lastKnownCwd: '', initialPath: '', homePath: '/' }), '');
  assert.equal(pickFilesOpenPath({}), '');
});

runTest('isUnresolvedFilesPath treats empty and / as not a Files home', () => {
  assert.equal(isUnresolvedFilesPath(''), true);
  assert.equal(isUnresolvedFilesPath('/'), true);
  assert.equal(isUnresolvedFilesPath('~'), true);
  assert.equal(isUnresolvedFilesPath(' / '), true);
  assert.equal(isUnresolvedFilesPath('/home/appserver'), false);
  assert.equal(isUnresolvedFilesPath('C:\\Users\\gajen'), false);
});

runTest('expandTildeWithHome maps ~ to a real home', () => {
  assert.equal(expandTildeWithHome('~', '/home/appserver'), '/home/appserver');
  assert.equal(expandTildeWithHome('~/src', '/home/appserver'), '/home/appserver/src');
  assert.equal(expandTildeWithHome('~', '/'), '~');
});

runTest('directory uses the listed Files path for empty space', () => {
  assert.equal(directoryFromFileLocation('/home/appserver'), '/home/appserver');
  assert.equal(directoryFromFileLocation(''), '');
});

runTest('directory on a folder uses the folder path, not /', () => {
  assert.equal(
    directoryFromFileLocation('/home/appserver', {
      type: 'd',
      name: 'data',
      path: '/home/appserver/data',
    }),
    '/home/appserver/data',
  );
  assert.equal(
    directoryFromFileLocation('/home/appserver', { type: 'd', name: 'data' }),
    '/home/appserver/data',
  );
});

runTest('directory on a file uses the parent folder', () => {
  assert.equal(
    directoryFromFileLocation('/home/appserver', {
      type: '-',
      name: '.bashrc',
      path: '/home/appserver/.bashrc',
    }),
    '/home/appserver',
  );
});

runTest('parentDirectory keeps posix and windows roots', () => {
  assert.equal(parentDirectory('/home/appserver/.bashrc'), '/home/appserver');
  assert.equal(parentDirectory('/home'), '/');
  assert.equal(parentDirectory('/'), '/');
  assert.equal(parentDirectory('C:\\Users\\gajen\\file.txt'), 'C:\\Users\\gajen');
});

console.log('Open-here path tests passed.');
