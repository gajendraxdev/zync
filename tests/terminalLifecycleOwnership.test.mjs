import { loadSource } from './helpers/loadSource.mjs';
import { runTypedTest } from './helpers/runTypedTest.mjs';

const tests = await runTypedTest(new URL('./terminalLifecycleOwnership.test.ts', import.meta.url));
if (tests) tests.runLifecycleOwnershipChecks(dependencies => loadSource('lib/terminal/terminalLifecycleListeners.ts', dependencies));
if (tests) await tests.runSpawnOwnershipChecks((dependencies, globals) => loadSource('lib/terminal/ptyLifecycle.ts', dependencies, globals));
