import { runTypedTest } from './helpers/runTypedTest.mjs';

await runTypedTest(new URL('./transferOperations.test.ts', import.meta.url));
