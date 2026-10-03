// The published SDK and operator CLI share one signing implementation.
export { generatePublisherKey, signPluginDirectory, verifySignedPlugin } from './sdk-internals.mjs';
