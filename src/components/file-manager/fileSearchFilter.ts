import type { FileEntry } from './types';

export type FileSearchTypeFilter =
  | 'all'
  | 'folders'
  | 'images'
  | 'text'
  | 'videos'
  | 'audio'
  | 'documents'
  | 'pdf';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'heic']);
const VIDEO_EXT = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac']);
const TEXT_EXT = new Set(['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'csv']);
const DOC_EXT = new Set(['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0) return '';
  return name.slice(i + 1).toLowerCase();
}

export function fileMatchesSearchType(file: FileEntry, filter: FileSearchTypeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'folders') return file.type === 'd';
  if (file.type === 'd') return false;
  const ext = extOf(file.name);
  if (filter === 'images') return IMAGE_EXT.has(ext);
  if (filter === 'videos') return VIDEO_EXT.has(ext);
  if (filter === 'audio') return AUDIO_EXT.has(ext);
  if (filter === 'text') return TEXT_EXT.has(ext);
  if (filter === 'pdf') return ext === 'pdf';
  if (filter === 'documents') return DOC_EXT.has(ext) || ext === 'pdf';
  return true;
}

export function fileMatchesQuery(file: FileEntry, term: string): boolean {
  if (!term) return true;
  return file.name.toLowerCase().includes(term.toLowerCase());
}
