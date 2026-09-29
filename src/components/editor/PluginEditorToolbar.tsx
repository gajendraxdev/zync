import { useMemo, useState } from 'react';
import { Keyboard, ListOrdered, Loader2, Save, Search, X } from 'lucide-react';

import { Button } from '../ui/Button';
import { KeyboardKey } from '../ui/KeyboardKey';
import { Modal } from '../ui/Modal';
import { Tooltip } from '../ui/Tooltip';

export type PluginEditorCommand = 'save' | 'find' | 'find-replace' | 'goto-line';

interface PluginEditorToolbarProps {
  dirty: boolean;
  filename: string;
  isReady: boolean;
  isSaving: boolean;
  onClose: () => void;
  onCommand: (command: PluginEditorCommand) => void;
  providerName: string;
  supports?: string[];
}

export function PluginEditorToolbar({
  dirty,
  filename,
  isReady,
  isSaving,
  onClose,
  onCommand,
  providerName,
  supports = [],
}: PluginEditorToolbarProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const capabilities = useMemo(() => new Set(supports), [supports]);
  const canSave = capabilities.has('save');
  const canSearch = capabilities.has('search');
  const canReplace = capabilities.has('replace');
  const canGoToLine = capabilities.has('goto-line');

  const shortcuts = useMemo(() => [
    ...(canSave ? [{ action: 'Save file', keys: ['Ctrl/Cmd', 'S'] }] : []),
    ...(canSearch ? [{ action: canReplace ? 'Find and replace' : 'Find', keys: ['Ctrl/Cmd', 'F'] }] : []),
    ...(canGoToLine ? [{ action: 'Go to line', keys: ['Ctrl/Cmd', 'G'] }] : []),
    { action: 'Close editor', keys: ['Ctrl/Cmd', 'W'] },
  ], [canGoToLine, canReplace, canSave, canSearch]);

  return (
    <>
      <div className="@container flex h-10 items-center justify-between gap-2 border-b border-app-border bg-app-panel px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h3 className="truncate text-sm font-medium text-app-text">{filename}</h3>
          <span aria-hidden="true" className="text-app-muted/50">·</span>
          <span className="truncate text-xs text-app-muted">{providerName}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!isReady && (
            <span className="px-2 text-[11px] text-app-muted">Connecting…</span>
          )}

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

          {canSave && (
            <Tooltip content={dirty ? 'Save · Ctrl/Cmd+S' : 'No unsaved changes'} position="bottom">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`h-8 gap-1.5 px-2 text-[11px] ${dirty ? '!text-app-accent' : '!text-app-muted'}`}
                aria-disabled={!isReady || isSaving}
                onClick={() => {
                  if (isReady && dirty && !isSaving) onCommand('save');
                }}
                aria-label={isSaving ? 'Saving file' : 'Save file'}
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <span>{isSaving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</span>
              </Button>
            </Tooltip>
          )}

          {canGoToLine && (
            <Tooltip content="Go to Line · Ctrl/Cmd+G" position="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 @min-[520px]:w-auto @min-[520px]:gap-1.5 @min-[520px]:px-2"
                disabled={!isReady}
                onClick={() => onCommand('goto-line')}
                aria-label="Go to line"
              >
                <ListOrdered className="h-3.5 w-3.5" />
                <span className="hidden text-[11px] @min-[520px]:inline">Go to Line</span>
              </Button>
            </Tooltip>
          )}

          {canSearch && (
            <Tooltip content={`${canReplace ? 'Find / Replace' : 'Find'} · Ctrl/Cmd+F`} position="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 @min-[520px]:w-auto @min-[520px]:gap-1.5 @min-[520px]:px-2"
                disabled={!isReady}
                onClick={() => onCommand(canReplace ? 'find-replace' : 'find')}
                aria-label={canReplace ? 'Find and replace' : 'Find'}
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden text-[11px] @min-[520px]:inline">
                  {canReplace ? 'Find / Replace' : 'Find'}
                </span>
              </Button>
            </Tooltip>
          )}

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
          {shortcuts.map(({ action, keys }) => (
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
