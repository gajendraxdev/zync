import assert from 'node:assert/strict';
import { decodeTerminalOutputChannelFrame } from '../.tmp-agent-tests/src/lib/terminal/terminalOutputFrame.js';
import {
  selectSnifferBytes,
  SNIFF_FULL_MAX_BYTES,
  SNIFF_TAIL_BYTES,
} from '../.tmp-agent-tests/src/lib/terminal/terminalSnifferBytes.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('decodeTerminalOutputChannelFrame parses generation and PTY bytes', () => {
  const payload = new Uint8Array([0x03, 0x00, 0x00, 0x00, 0x24, 0x50, 0x53]);
  const buffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
  const decoded = decodeTerminalOutputChannelFrame(buffer);
  assert.equal(decoded.generation, 3);
  assert.deepEqual(decoded.data, new Uint8Array([0x24, 0x50, 0x53]));
});

runTest('decodeTerminalOutputChannelFrame rejects truncated header', () => {
  const payload = new Uint8Array([0x01, 0x00, 0x00]);
  const buffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
  assert.throws(
    () => decodeTerminalOutputChannelFrame(buffer),
    RangeError,
  );
});

runTest('decodeTerminalOutputChannelFrame handles empty PTY payload', () => {
  const payload = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
  const buffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
  const decoded = decodeTerminalOutputChannelFrame(buffer);
  assert.equal(decoded.generation, 1);
  assert.equal(decoded.data.length, 0);
});

runTest('selectSnifferBytes returns the same view when length <= 8192', () => {
  const data = new Uint8Array(SNIFF_FULL_MAX_BYTES);
  data[0] = 1;
  data[data.length - 1] = 9;
  const out = selectSnifferBytes(data);
  assert.equal(out.length, SNIFF_FULL_MAX_BYTES);
  assert.equal(out, data);
});

runTest('selectSnifferBytes returns last 4096 bytes when length is 8193', () => {
  const data = new Uint8Array(SNIFF_FULL_MAX_BYTES + 1);
  data[0] = 7;
  data[data.length - 1] = 42;
  const out = selectSnifferBytes(data);
  assert.equal(out.length, SNIFF_TAIL_BYTES);
  assert.equal(out[out.length - 1], 42);
  assert.notEqual(out[0], 7);
});

runTest('selectSnifferBytes empty and exact 4096 boundaries', () => {
  assert.equal(selectSnifferBytes(new Uint8Array(0)).length, 0);
  const exactTail = new Uint8Array(SNIFF_TAIL_BYTES);
  assert.equal(selectSnifferBytes(exactTail), exactTail);
});

console.log('Terminal output stream tests passed.');