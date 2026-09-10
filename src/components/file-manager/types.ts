export interface FileEntry {
  name: string;
  type: '-' | 'd' | 'l';
  size: number;
  lastModified: number; // Changed from modifyTime
  permissions: string; // Changed from rights object
  path: string;
  /** Unix owner name, or uid when the name is unknown. Empty (UI shows —) on Windows local Files and WSL listings. */
  owner: string;
  /** Unix group name, or gid when the name is unknown. Empty (UI shows —) on Windows local Files and WSL listings. */
  group: string;
}
