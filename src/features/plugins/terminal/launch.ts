import type { PluginTerminalLaunch } from './types.js';

const MAX_ARGUMENTS = 64;
const MAX_LAUNCH_BYTES = 16 * 1024;
const MAX_CONNECTION_TOKEN_LENGTH = 256;
const encoder = new TextEncoder();
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

/**
 * Validate and snapshot an untrusted terminal proposal before any async work.
 * Native validation is still mandatory. There is deliberately no connectionId,
 * script field, environment, stdin, or existing workspace terminal ID. Explicit
 * shell programs are still remote code execution, not a command sandbox.
 */
export function parsePluginTerminalLaunch(value: unknown): PluginTerminalLaunch {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('A terminal launch proposal is required');
    }
    const proposal = value as Record<string, unknown>;
    const keys = Object.keys(proposal);
    if (keys.some(key => !['program', 'args', 'expectedConnectionToken'].includes(key))) {
        throw new Error('Unknown terminal launch field');
    }
    const { program, args, expectedConnectionToken } = proposal;
    if (typeof program !== 'string' || !program.trim() || program.startsWith('-')) {
        throw new Error('Invalid terminal program');
    }
    if (!Array.isArray(args) || args.length > MAX_ARGUMENTS) {
        throw new Error('Invalid terminal argument count');
    }
    let bytes = 0;
    for (const argument of [program, ...args]) {
        if (typeof argument !== 'string') {
            throw new Error('Terminal arguments must be strings without control characters');
        }
        // Avoid encoding or scanning an enormous string before bounding it.
        if (argument.length > MAX_LAUNCH_BYTES) throw new Error('Terminal launch exceeds 16 KiB');
        if (CONTROL_CHARACTERS.test(argument)) {
            throw new Error('Terminal arguments must be strings without control characters');
        }
        bytes += encoder.encode(argument).byteLength;
        if (bytes > MAX_LAUNCH_BYTES) throw new Error('Terminal launch exceeds 16 KiB');
    }
    if (typeof expectedConnectionToken !== 'string'
        || !expectedConnectionToken
        || expectedConnectionToken.length > MAX_CONNECTION_TOKEN_LENGTH
        || CONTROL_CHARACTERS.test(expectedConnectionToken)) {
        throw new Error('A current connection token is required');
    }
    return Object.freeze({
        program,
        args: Object.freeze([...args] as string[]),
        expectedConnectionToken,
    });
}
