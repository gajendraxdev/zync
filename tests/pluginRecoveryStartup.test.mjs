import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute the actual recovery gate without rendering React or starting Workers.
const source = fs.readFileSync(new URL('../src/context/PluginContext.tsx', import.meta.url), 'utf8');
const start = source.indexOf('let recovery: NativePluginRecoveryStatus;');
const end = source.indexOf("console.log('[Plugins] Discovered:'", start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(`async function gate(getNativePluginRecoveryStatus, isCurrent, setPluginSafeMode, runtimeSupervisor) {
${source.slice(start, end)}
return recovery;
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const gate = new Function(`${code}; return gate;`)();
const restored = [];
const supervisor = { current: { restoreFailures: (...args) => restored.push(args) } };
let safeMode;
const readError = new Error('IPC unavailable');
await assert.rejects(
  gate(async () => { throw readError; }, () => true, value => { safeMode = value; }, supervisor),
  /Plugin startup blocked: recovery history is unavailable/,
);
assert.deepEqual(restored, [], 'failed reads must not replace retained quarantine');
assert.equal(safeMode, undefined, 'failed reads must not change recovery state');
const recovery = await gate(async () => ({ safeMode: true, diagnostics: [{
  pluginId: 'dev.example.monitor', failures: [{ atMs: 123, kind: 'worker-error' }],
}] }), () => true, value => { safeMode = value; }, supervisor);
assert.equal(recovery.safeMode, false, 'legacy global pause remains disabled');
assert.deepEqual(restored, [['dev.example.monitor', [123], 'worker-error']]);
assert.equal(safeMode, false);
console.log('Plugin recovery startup gate regression tests passed.');
