import { runTypedTest } from './helpers/runTypedTest.mjs';

await runTypedTest(new URL('./fileDestinationReservations.test.ts', import.meta.url));
