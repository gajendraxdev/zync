export const GENERATION_HEADER_BYTES = 4;

export interface TerminalOutputChannelFrame {
  generation: number;
  data: Uint8Array;
}

/** Decodes a raw IPC channel frame: u32 LE generation + PTY bytes. */
export function decodeTerminalOutputChannelFrame(buffer: ArrayBuffer): TerminalOutputChannelFrame {
  if (buffer.byteLength < GENERATION_HEADER_BYTES) {
    throw new RangeError('PTY output channel frame too short');
  }
  const view = new DataView(buffer);
  const generation = view.getUint32(0, true);
  const data = new Uint8Array(buffer, GENERATION_HEADER_BYTES);
  return { generation, data };
}

export function terminalOutputMessageToArrayBuffer(message: unknown): ArrayBuffer | null {
  if (message instanceof ArrayBuffer) {
    return message;
  }
  if (message instanceof Uint8Array) {
    return message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength);
  }
  return null;
}
