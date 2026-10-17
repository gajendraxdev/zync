import { useState } from 'react';
import { Keyboard, ListOrdered, Loader2, Save, Search, X } from 'lucide-react';

import { CODEMIRROR_SHORTCUTS } from './keymap';
import { Button } from '../../ui/Button';
import { KeyboardKey } from '../../ui/KeyboardKey';
import { Modal } from '../../ui/Modal';
import { Tooltip } from '../../ui/Tooltip';
import { EditorSaveAccessStatus } from '../EditorSaveAccessStatus';
import { editorSaveBlocked, type EditorSaveAccess } from '../../../features/files/domain/editorSaveAccess';

interface CodeMirrorToolbarProps {
  filename: string;
  isDirty: boolean;
  isSaving: boolean;
  onClose: () => void;
  onGoToLine: () => void;
  onOpenSearch: () => void;
  onSave: () => void;
  saveAccess?: EditorSaveAccess;
}

export function CodeMirrorToolbar({
  filename,
  isDirty,
  isSaving,
  onClose,
  onGoToLine,
  onOpenSearch,
  onSave,
  saveAccess,
}: CodeMirrorToolbarProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const saveDisabled = isSaving || !isDirty || editorSaveBlocked(saveAccess);

  return (
    <>
      <div className="@container flex min-h-10 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-app-border px-3 py-1">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
          <div className="truncate text-sm font-semibold text-app-text">{filename}</div>
          <EditorSaveAccessStatus access={saveAccess} />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content="Editor shortcuts" position="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 @min-[760px]:w-auto @min-[760px]:gap-1.5 @min-[760px]:px-2"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Show editor shortcuts"
            >
              <Keyboard className="h-3.5 w-3.5" />
              <span className="hidden text-[11px] @min-[760px]:inline">Shortcuts</span>
            </Button>
          </Tooltip>

          <Tooltip content={editorSaveBlocked(saveAccess) ? saveAccess!.reason : isDirty ? 'Save · Ctrl/Cmd+S' : 'No unsaved changes'} position="bottom" disabledTrigger={saveDisabled}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-8 gap-1.5 px-2 text-[11px] ${!saveDisabled ? '!text-app-accent' : '!text-app-muted'}`}
              disabled={saveDisabled}
              onClick={() => {
                if (!saveDisabled) onSave();
              }}
              aria-label={isSaving ? 'Saving file' : 'Save file'}
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{isSaving ? 'Saving…' : isDirty ? 'Save' : 'Saved'}</span>
            </Button>
          </Tooltip>

          <Tooltip content="Go to Line · Ctrl/Cmd+G" position="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 @min-[520px]:w-auto @min-[520px]:gap-1.5 @min-[520px]:px-2"
              onClick={onGoToLine}
              aria-label="Go to line"
            >
              <ListOrdered className="h-3.5 w-3.5" />
              <span className="hidden text-[11px] @min-[520px]:inline">Go to Line</span>
            </Button>
          </Tooltip>

          <Tooltip content="Find / Replace · Ctrl/Cmd+F" position="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 @min-[520px]:w-auto @min-[520px]:gap-1.5 @min-[520px]:px-2"
              onClick={onOpenSearch}
              aria-label="Find and replace"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden text-[11px] @min-[520px]:inline">Find / Replace</span>
            </Button>
          </Tooltip>

          <Tooltip content="Close editor · Ctrl/Cmd+W" position="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onClose}
              aria-label="Close editor"
            >
              <X className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <Modal
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Editor shortcuts"
        subtitle={`Keyboard controls available while editing ${filename}`}
        width="max-w-lg"
        contentClassName="p-4"
      >
        <div className="divide-y divide-app-border/60 overflow-hidden rounded-lg border border-app-border">
          {CODEMIRROR_SHORTCUTS.map(({ action, keys }) => (
            <div key={action} className="flex items-center justify-between gap-4 px-3 py-2.5">
              <span className="text-sm text-app-text">{action}</span>
              <div className="flex shrink-0 items-center gap-1">
                {keys.map((key, index) => (
                  <span key={`${action}:${key}`} className="flex items-center gap-1">
                    {index > 0 && <span className="text-[10px] text-app-muted">+</span>}
                    <KeyboardKey>{key}</KeyboardKey>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
