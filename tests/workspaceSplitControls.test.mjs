import { runTypedTest } from './helpers/runTypedTest.mjs';

await runTypedTest(new URL('./workspaceSplitControls.test.ts', import.meta.url));
