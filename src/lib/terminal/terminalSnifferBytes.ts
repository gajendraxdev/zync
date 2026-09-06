export const SNIFF_FULL_MAX_BYTES = 8192;
export const SNIFF_TAIL_BYTES = 4096;

/** Bytes to feed sniffers. Large frames: bounded tail only. */
export function selectSnifferBytes(data: Uint8Array): Uint8Array {
  if (data.length <= SNIFF_FULL_MAX_BYTES) return data;
  return data.subarray(data.length - SNIFF_TAIL_BYTES);
}
