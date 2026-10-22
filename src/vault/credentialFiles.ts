import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export type CredentialFileKind = 'privateKey' | 'sshCertificate';

/** Import only a user-selected local text file, using the existing bounded native reader. */
export async function pickCredentialFile(kind: CredentialFileKind): Promise<string | null> {
  const title = kind === 'privateKey' ? 'Import private key file' : 'Import SSH certificate file';
  const path = await open({ title, multiple: false, directory: false });
  if (typeof path !== 'string') return null;
  const content = await invoke<string>('fs_read_file', {
    connectionId: 'local', path, maxBytes: kind === 'privateKey' ? 1024 * 1024 : 64 * 1024,
  });
  if (!content.trim()) throw new Error('The selected file is empty.');
  if (kind === 'privateKey' && !/^\s*-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/.test(content)) {
    throw new Error('Select a PEM or OpenSSH private key file.');
  }
  if (kind === 'sshCertificate' && !/^\s*\S+-cert-v01@openssh\.com[ \t]+\S+/.test(content)) {
    throw new Error('Select an OpenSSH user certificate (-cert.pub), not a public key or CA file.');
  }
  return content;
}
