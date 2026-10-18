import { ChevronRight } from 'lucide-react';
import { useCallback } from 'react';
import { FileActionMenu } from './FileActionMenu';
import { isFilePathEqual } from './filePathNav';
import type { FileFolderLoader } from './fileFolderOptions';
import type { ContextMenuItem } from '../ui/ContextMenu';
import { CONTROL_INSET_FOCUS_CLASSES } from '../ui/controlStyles';

/** A breadcrumb separator doubles as an on-demand child-folder menu, not a second navigation owner. */
export function FileFolderMenu({ parentPath, parentLabel, currentChild, loadFolders, onNavigate, disabled }: {
  parentPath: string;
  parentLabel: string;
  currentChild: string;
  loadFolders: FileFolderLoader;
  onNavigate: (path: string) => void;
  disabled?: boolean;
}) {
  const items = useCallback(async (): Promise<ContextMenuItem[]> => {
    const folders = await loadFolders(parentPath);
    return folders.length ? folders.map(folder => ({
      label: folder.name, checked: isFilePathEqual(folder.path, currentChild), checkType: 'radio',
      action: () => { if (!isFilePathEqual(folder.path, currentChild)) onNavigate(folder.path); },
    })) : [
      { label: 'No subfolders', disabled: true, action: () => {} },
      { label: 'Close', action: () => {} },
    ];
  }, [parentPath, currentChild, loadFolders, onNavigate]);
  return <FileActionMenu label={`Folders in ${parentLabel}`} tooltip={`Show folders in ${parentPath}`} icon={<ChevronRight size={12} />}
    iconOnly disabled={disabled} items={items} errorLabel="Unable to load folders"
    triggerClassName={`w-6 px-0 text-app-muted/60 ${CONTROL_INSET_FOCUS_CLASSES}`} menuClassName="w-64 [&_button>span:last-child]:break-all" />;
}
