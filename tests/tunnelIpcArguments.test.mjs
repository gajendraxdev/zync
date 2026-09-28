import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Exercise the actual IPC wrapper; substitute native APIs instead of requiring Tauri.
const calls = [];
globalThis.__tunnelBridgeInvoke = async (command, payload) => {
  calls.push({ command, payload });
};

try {
  const source = fs.readFileSync(new URL('../src/lib/tauri-ipc.ts', import.meta.url), 'utf8');
  const withoutImports = source.replace(/^import .*;\r?$/gm, '');
  const stubs = `
    const invoke = globalThis.__tunnelBridgeInvoke;
    const listen = async () => () => {};
    const check = async () => null;
    const getVersion = async () => 'test';
    const dialogOpen = async () => null;
    const dialogSave = async () => null;
    const createUpdaterIpcHandler = () => ({});
  `;
  const compiled = ts.transpileModule(stubs + withoutImports, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const { ipcRenderer } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  );

  for (const argument of [
    'ssh-test-connection',
    { connectionId: 'ssh-test-connection' },
    { connection_id: 'ssh-test-connection' },
    { connectionId: 'ssh-test-connection', connection_id: 'obsolete-id' },
  ]) {
    await ipcRenderer.invoke('tunnel:reconcileConnection', argument);
    assert.deepEqual(calls.pop(), {
      command: 'tunnel_reconcile_connection',
      payload: { connectionId: 'ssh-test-connection' },
    });
  }

  console.log('Tunnel IPC argument regression tests passed.');
} finally {
  delete globalThis.__tunnelBridgeInvoke;
}
