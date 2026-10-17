import { runTypedTest } from './helpers/runTypedTest.mjs';

await runTypedTest(new URL('./fileSystemRefresh.test.ts', import.meta.url));
