import { runTypedTest } from './helpers/runTypedTest.mjs';
await runTypedTest(new URL('./ghostCwdSafety.test.ts', import.meta.url));
