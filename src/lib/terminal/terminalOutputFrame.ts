/** Native output carries a generation and a cumulative-credit sequence. */
export const TERMINAL_OUTPUT_HEADER_BYTES = 8;
export const TERMINAL_OUTPUT_MAX_DATA_BYTES = 16 * 1024;

export interface TerminalOutputChannelFrame {
  generation: number;
  sequence: number;
  data: Uint8Array;
}

/** Decode the bounded native frame: u32 LE generation, u32 LE sequence, PTY bytes. */
export function decodeTerminalOutputChannelFrame(buffer: ArrayBuffer): TerminalOutputChannelFrame {
  if (buffer.byteLength < TERMINAL_OUTPUT_HEADER_BYTES
    || buffer.byteLength > TERMINAL_OUTPUT_HEADER_BYTES + TERMINAL_OUTPUT_MAX_DATA_BYTES) {
    throw new RangeError('Invalid PTY output channel frame size');
  }
  const view = new DataView(buffer);
  const generation = view.getUint32(0, true);
  const sequence = view.getUint32(4, true);
  const data = new Uint8Array(buffer, TERMINAL_OUTPUT_HEADER_BYTES);
  return { generation, sequence, data };
}

/** Normalize supported Tauri binary representations without exposing adjacent view bytes. */
export function terminalOutputMessageToArrayBuffer(message: unknown): ArrayBuffer | null {
  if (message instanceof ArrayBuffer) {
    return message;
  }
  if (message instanceof Uint8Array) {
    return message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength);
  }
  return null;
}
