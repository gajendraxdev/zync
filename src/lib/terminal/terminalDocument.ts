import { getCspStyleNonce } from '../cspStyleNonce.js';

const documents = new WeakMap<Document, Document>();

/**
 * Supply xterm's public documentOverride with a host-only document adapter.
 * Tauri release CSP requires its nonce on runtime style elements. Assign it at
 * creation, before xterm inserts styles, including after WebGL-to-DOM fallback.
 * xterm 6's viewport bypasses documentOverride when creating scrollbar styles;
 * terminal-owned divs also authorize style children synchronously on insertion.
 * Native document methods retain their receiver; the real document is unchanged.
 * Development documents without a nonce need no adapter or additional work.
 */
export function getTerminalDocument(root: Document): Document {
  const existing = documents.get(root);
  if (existing) return existing;

  const nonce = getCspStyleNonce(root);
  if (!nonce) return root;

  // Preserve Document's tag-specific return types, including deprecated tags.
  function createElement<K extends keyof HTMLElementTagNameMap>(tagName: K, options?: ElementCreationOptions): HTMLElementTagNameMap[K];
  function createElement<K extends keyof HTMLElementDeprecatedTagNameMap>(tagName: K, options?: ElementCreationOptions): HTMLElementDeprecatedTagNameMap[K];
  function createElement(tagName: string, options?: ElementCreationOptions): HTMLElement;
  function createElement(tagName: string, options?: ElementCreationOptions): HTMLElement {
    const element = root.createElement(tagName, options);
    if (element.localName === 'style') {
      (element as HTMLStyleElement).nonce = nonce;
    } else if (element.localName === 'div') {
      // Limit the insertion bridge to xterm-owned containers. Do not patch any
      // DOM prototype or document method, or observe arbitrary host/plugin CSS.
      const appendChild = element.appendChild;
      element.appendChild = function <T extends Node>(child: T): T {
        if (child.nodeType === 1 && (child as unknown as Element).localName === 'style') {
          (child as unknown as HTMLStyleElement).nonce = nonce;
        }
        return appendChild.call(this, child) as T;
      };
    }
    return element;
  }
  const methods = new Map<PropertyKey, unknown>();
  const adapter = new Proxy(root, {
    get(target, property) {
      if (property === 'createElement') return createElement;
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function' || property === 'constructor') return value;
      if (!methods.has(property)) methods.set(property, value.bind(target));
      return methods.get(property);
    },
  });
  documents.set(root, adapter);
  return adapter;
}
