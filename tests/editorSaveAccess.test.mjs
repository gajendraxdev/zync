import { runTypedTest } from './helpers/runTypedTest.mjs';
await runTypedTest(new URL('./editorSaveAccess.test.ts', import.meta.url));
