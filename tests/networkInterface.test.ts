import { prepareNetworkInterface, requestNetworkInterface, finishNetworkPrompt, cancelNetworkPrompts,
    NetworkSelectionCancelledError, useNetworkPromptStore, persistHostWithNetwork, type NetworkPreference } from '../src/features/connections/application/networkInterface.js';
import type { ConnectConfig } from '../src/features/connections/domain/connectionConfig.js';

/** Small assertions match the existing typed agent-test convention. */
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
/** Each test gets a new runtime config, never a saved host or live SSH connection. */
function config(id = 'host'): ConnectConfig {
    return { id, name: id, host: 'fixture.invalid', port: 22, username: 'fixture', auth_method: { type: 'Password', password: 'fixture' }, jump_host: null };
}

const direct = config();
await prepareNetworkInterface(direct, { getPreference: async () => ({ mode: 'interface', id: 'stable-guid' }) });
check(direct.network_interface_id === 'stable-guid', 'Saved adapter identity reaches runtime dial');
check(!('network_interface_id' in config()), 'Routing choice is not a default/saved host field');

let prompts = 0;
let promptLabel = '';
const ask = config();
await prepareNetworkInterface(ask, { getPreference: async () => ({ mode: 'ask' }), request: async (_owner, label) => {
    promptLabel = label;
    prompts++; return { interfaceId: 'vpn-2' };
} });
check(prompts === 1 && ask.network_interface_id === 'vpn-2', 'Ask once and retain choice for backend reconnect');
check(promptLabel.includes('fixture@fixture.invalid'), 'Connect-time choice identifies the actual SSH endpoint');

const target = { ...config('target'), jump_host: config('bastion') };
const requestedIds: string[] = [];
await prepareNetworkInterface(target, { preference: { mode: 'interface', id: 'ignored-target' }, getPreference: async id => {
    requestedIds.push(id); return { mode: 'interface', id: 'bastion-vpn' };
} });
check(requestedIds.join() === 'bastion', 'Only first local TCP hop resolves routing preference');
check(target.network_interface_id === undefined && target.jump_host.network_interface_id === 'bastion-vpn', 'Do not pretend to route the remote target socket locally');

let cancelled = false;
try { await prepareNetworkInterface(config(), { getPreference: async () => ({ mode: 'ask' }), request: async () => null }); }
catch (error) { cancelled = error instanceof NetworkSelectionCancelledError; }
check(cancelled, 'Cancelling adapter picker cancels the connection');

let requestedAfterCancel = false;
try { await prepareNetworkInterface(config(), { cancelled: () => true,
    getPreference: async () => ({ mode: 'ask' }), request: async () => { requestedAfterCancel = true; return {}; } }); }
catch (error) { check(error instanceof NetworkSelectionCancelledError, 'Cancellation has a quiet typed outcome'); }
check(!requestedAfterCancel, 'No new dialog after cancellation during preference load');

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
for (const platform of ['Win32', 'Linux x86_64', 'MacIntel']) {
    Object.defineProperty(globalThis, 'navigator', { value: { platform }, configurable: true });
    const routed = config(platform);
    await prepareNetworkInterface(routed, { getPreference: async () => ({ mode: 'interface', id: 'selected-device' }) });
    check(routed.network_interface_id === 'selected-device', `Routing is not gated by browser platform: ${platform}`);
    const normal = { ...config(platform), network_interface_id: 'stale' };
    await prepareNetworkInterface(normal, { getPreference: async () => ({ mode: 'default' }) });
    check(normal.network_interface_id === undefined, 'System default clears old runtime selection');
}
if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
else Reflect.deleteProperty(globalThis, 'navigator');
let readFailed = false;
try { await prepareNetworkInterface(config(), { getPreference: async () => { throw new Error('Unreadable preferences'); } }); }
catch { readFailed = true; }
check(readFailed, 'Preference errors never silently fall back on any OS');
const first = requestNetworkInterface('one', 'One');
const second = requestNetworkInterface('two', 'Two');
const firstId = useNetworkPromptStore.getState().requests[0].id;
cancelNetworkPrompts('one');
check(await first === null, 'Cancelling active owner resolves and advances queue');
finishNetworkPrompt(firstId, { interfaceId: 'stale' });
check(useNetworkPromptStore.getState().requests.length === 1, 'Stale callback cannot finish next owner');
finishNetworkPrompt(useNetworkPromptStore.getState().requests[0].id, { interfaceId: 'selected' });
check((await second)?.interfaceId === 'selected', 'Next queued owner receives only its own choice');
const pending = Array.from({ length: 16 }, (_, index) => requestNetworkInterface(`bounded-${index}`, 'fixture'));
let overflow = false;
try { await requestNetworkInterface('overflow', 'fixture'); } catch { overflow = true; }
check(overflow && useNetworkPromptStore.getState().requests.length === 16, 'Prompt queue has a hard bound');
for (let index = 0; index < pending.length; index++) cancelNetworkPrompts(`bounded-${index}`);
await Promise.all(pending);
check(useNetworkPromptStore.getState().requests.length === 0, 'All cancelled prompts release retained callbacks');
console.log('Network interface regression checks passed');

const events: string[] = [];
let preference: NetworkPreference = { mode: 'ask' };
const storage = { get: async () => preference, save: async (_id: string, next: NetworkPreference) => { events.push(`routing:${next.mode}`); preference = next; } };
await persistHostWithNetwork('save', { mode: 'interface', id: 'vpn' }, async () => { events.push('host'); }, storage);
check(events.join() === 'routing:interface,host', 'Persist routing before publishing host');
events.length = 0;
try { await persistHostWithNetwork('save', { mode: 'default' }, async () => { events.push('host-failed'); throw new Error('fixture save failure'); }, storage); }
catch { /* Expected failed host persistence. */ }
check(events.join() === 'routing:default,host-failed,routing:interface', 'Failed host persistence restores old routing preference');
let published = false;
try { await persistHostWithNetwork('save', { mode: 'ask' }, async () => { published = true; }, { get: storage.get, save: async () => { throw new Error('fixture disk failure'); } }); }
catch { /* Expected failed routing persistence. */ }
check(!published, 'Routing write failure cannot publish a host using old/default routing');

let finishRead: ((value: NetworkPreference) => void) | undefined;
let lateCancelled = false;
const closedConfig = config('closed-test');
const late = prepareNetworkInterface(closedConfig, { cancelled: () => lateCancelled,
    getPreference: () => new Promise(resolve => { finishRead = resolve; }), request: async () => { throw new Error('Closed editor must not open a picker'); } });
lateCancelled = true;
finishRead?.({ mode: 'ask' });
let stoppedLate = false;
try { await late; } catch (error) { stoppedLate = error instanceof NetworkSelectionCancelledError; }
check(stoppedLate && closedConfig.network_interface_id === undefined, 'Late preference result cannot connect a closed editor');
