import { Folder } from 'lucide-react';
import { memo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { findIconTheme } from '../../lib/icons/iconTheme';
import { usePlugins } from '../../context/PluginContext';
import { DynamicIcon } from '../ui/DynamicIcon';
import type { FileEntry } from './types';

/** One renderer for listing, Places and Properties; legacy folder appearance stays intact. */
export const FileEntryIcon = memo(function FileEntryIcon({ file, size }: {
  file: Pick<FileEntry, 'name' | 'type'>;
  size: number;
}) {
  const theme = useAppStore(state => state.settings.iconTheme);
  const { plugins } = usePlugins();
  const provider = findIconTheme(plugins, theme);
  if (file.type === 'd' && (!provider || (!provider.manifest.iconTheme && provider.path.startsWith('builtin://')))) {
    return <Folder size={size} fill="currentColor" className="shrink-0 text-app-accent" strokeWidth={0.5} aria-hidden="true" />;
  }
  return <DynamicIcon type={file.name} isFolder={file.type === 'd'} size={size} />;
});
