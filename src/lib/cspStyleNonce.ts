/** Return the nonce Tauri assigned to bundled release styles, when present. */
export function getCspStyleNonce(root: Document = document): string | undefined {
  const nonce = root.querySelector<HTMLStyleElement>('head style[nonce]')?.nonce?.trim();
  return nonce || undefined;
}

/** Apply the release style nonce before inserting a runtime-created style. */
export function applyCspStyleNonce(style: HTMLStyleElement, root: Document = document): void {
  const nonce = getCspStyleNonce(root);
  if (nonce) style.nonce = nonce;
}
