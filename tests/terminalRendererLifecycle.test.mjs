import { loadSource } from './helpers/loadSource.mjs';
import { runTypedTest } from './helpers/runTypedTest.mjs';

const tests = await runTypedTest(new URL('./terminalRendererLifecycle.test.ts', import.meta.url));
if (tests) {
  await tests.runRendererLifecycleChecks((dependencies, globals) =>
    loadSource('components/terminal/useTerminalLifecycle.ts', dependencies, globals));
  await tests.runRendererOwnershipChecks((file, dependencies, globals) =>
    loadSource(file, dependencies, globals));
}
