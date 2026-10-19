import { loadSource } from './helpers/loadSource.mjs';
import { runTypedTest } from './helpers/runTypedTest.mjs';

const tests = await runTypedTest(new URL('./terminalOutputFlow.test.ts', import.meta.url));
if (tests) {
  await tests.runOutputFlowChecks((dependencies, globals) =>
    loadSource('lib/terminal/terminalOutputStream.ts', dependencies, globals));
}
