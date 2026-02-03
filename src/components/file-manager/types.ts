export interface FileEntry {
  name: string;
  type: '-' | 'd' | 'l';
  size: number;
  lastModified: number; // Changed from modifyTime
  permissions: string; // Changed from rights object
  path: string;
}
