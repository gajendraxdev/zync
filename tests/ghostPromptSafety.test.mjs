import { runTypedTest } from './helpers/runTypedTest.mjs';
await runTypedTest(new URL('./ghostPromptSafety.test.ts', import.meta.url));
