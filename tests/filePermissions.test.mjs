import { runTypedTest } from './helpers/runTypedTest.mjs';
await runTypedTest(new URL('./filePermissions.test.ts', import.meta.url));
