import * as checker from '../scripts/check-changed-function-docs.mjs';
import { runTypedTest } from './helpers/runTypedTest.mjs';

const tests = await runTypedTest(new URL('./changedFunctionDocs.test.ts', import.meta.url));
if (tests) tests.runChangedFunctionDocsChecks(checker);
