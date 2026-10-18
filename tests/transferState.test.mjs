import { runTypedTest } from './helpers/runTypedTest.mjs';

await runTypedTest(new URL('./transferState.test.ts', import.meta.url));
