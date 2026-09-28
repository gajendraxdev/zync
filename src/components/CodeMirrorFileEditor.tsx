import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { historyField } from '@codemirror/commands';
import { Compartment, EditorSelection, EditorState, Transaction, type Extension, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';

import { CodeMirrorToolbar } from './editor/codemirror/CodeMirrorToolbar';
import { buildLineCommentChanges } from './editor/codemirror/comments';
import { createCodeMirrorExtensions } from './editor/codemirror/extensions';
import { getLanguageLabel, getLineCommentToken } from './editor/codemirror/fileTypes';
import { GoToLinePanel } from './editor/codemirror/GoToLinePanel';
import { isCommentShortcut } from './editor/codemirror/keymap';
import { loadCodeMirrorLanguage } from './editor/codemirror/language';
import { resolveCodeMirrorPerformanceMode } from './editor/codemirror/performance';
import { resolveSavedBaseline } from './editor/codemirror/saveState';
import {
  deleteCodeMirrorSession,
  saveCodeMirrorSession,
  takeCodeMirrorSession,
} from './editor/codemirror/sessionCache';
import { formatCodeMirrorStatus } from './editor/codemirror/status';
import { createCodeMirrorHighlightStyle, createCodeMirrorTheme } from './editor/codemirror/theme';
import {
  clearEditorStatus,
  createEditorStatusSource,
  publishEditorStatus,
} from '../features/editor/editorStatus';
import { useAppStore } from '../store/useAppStore';

interface CodeMirrorFileEditorProps {
  documentId?: string;
  filename: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
  hideToolbar?: boolean;
}

function parseGoToLineInput(input: string, maxLine: number) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const [linePart, columnPart] = trimmed.split(/[:.,]/);
  const line = Number(linePart);
  if (!Number.isFinite(line)) return null;

  const resolvedLine = Math.max(1, Math.min(maxLine, Math.floor(line)));
  const column = columnPart !== undefined && columnPart !== ''
    ? Math.max(1, Math.floor(Number(columnPart)))
    : null;

  return {
    line: resolvedLine,
    column: Number.isFinite(column) ? column : null,
  };
}

function useDocumentPerformanceMode(sessionKey: string, initialContent: string) {
  const resolvedModeRef = useRef<{
    sessionKey: string;
    mode: ReturnType<typeof resolveCodeMirrorPerformanceMode>;
  } | null>(null);

  if (resolvedModeRef.current?.sessionKey !== sessionKey) {
    resolvedModeRef.current = {
      sessionKey,
      mode: resolveCodeMirrorPerformanceMode(initialContent),
    };
  }

  return resolvedModeRef.current.mode;
}

export function CodeMirrorFileEditor({
  documentId,
  filename,
  initialContent,
  onSave,
  onClose,
  hideToolbar = false,
}: CodeMirrorFileEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment()).current;
  const themeCompartment = useRef(new Compartment()).current;
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showGoToLine, setShowGoToLine] = useState(false);
  const [goToLineValue, setGoToLineValue] = useState('');
  const [goToLineError, setGoToLineError] = useState<string | null>(null);
  const goToLineInputRef = useRef<HTMLInputElement>(null);
  const showConfirmDialog = useAppStore((state) => state.showConfirmDialog);
  const showToast = useAppStore((state) => state.showToast);
  const theme = useAppStore((state) => state.settings.theme);
  const sessionKey = documentId ?? filename;

  const lineCommentToken = useMemo(() => getLineCommentToken(filename), [filename]);
  const languageLabel = useMemo(() => getLanguageLabel(filename), [filename]);
  const performanceMode = useDocumentPerformanceMode(sessionKey, initialContent);
  const saveRef = useRef<() => Promise<void> | void>(() => {});
  const closeRef = useRef<() => Promise<void> | void>(() => {});
  const toggleCommentRef = useRef<(view: EditorView) => boolean>(() => false);
  const savedDocRef = useRef<Text | null>(null);
  const isDirtyRef = useRef(false);
  const isSavingRef = useRef(false);
  const statusFrameRef = useRef<number | null>(null);
  const statusSourceRef = useRef(createEditorStatusSource(`codemirror:${filename}`));
  const discardSessionRef = useRef(false);

  const updateDirtyState = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty((current) => current === dirty ? current : dirty);
  }, []);

  const publishStatus = useCallback((state: EditorState) => {
    if (statusFrameRef.current !== null) {
      cancelAnimationFrame(statusFrameRef.current);
    }

    statusFrameRef.current = requestAnimationFrame(() => {
      statusFrameRef.current = null;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      publishEditorStatus(
        statusSourceRef.current,
        formatCodeMirrorStatus(
          filename,
          line.number,
          head - line.from + 1,
          languageLabel,
          isDirtyRef.current,
        ),
      );
    });
  }, [filename, languageLabel]);

  const resolvedThemeMode = theme === 'light' ? 'light' : 'dark';
  const createTheme = useCallback(() => createCodeMirrorTheme(resolvedThemeMode), [resolvedThemeMode]);

  const handleSave = useCallback(async () => {
    const view = viewRef.current;
    if (!view || isSavingRef.current) return;

    isSavingRef.current = true;
    setIsSaving(true);

    const savedDocument = view.state.doc;
    const baselineAtSaveStart = savedDocRef.current;
    try {
      await onSave(savedDocument.toString());
      savedDocRef.current = resolveSavedBaseline(
        baselineAtSaveStart,
        savedDocRef.current,
        savedDocument,
      );
      updateDirtyState(
        savedDocRef.current === null || !view.state.doc.eq(savedDocRef.current),
      );
      publishStatus(view.state);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save file';
      showToast('error', message);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
      requestAnimationFrame(() => view.focus());
    }
  }, [onSave, publishStatus, showToast, updateDirtyState]);

  const handleClose = useCallback(async () => {
    if (!isDirtyRef.current) {
      onClose();
      return;
    }

    const confirmed = await showConfirmDialog({
      title: 'Discard unsaved changes?',
      message: `Close ${filename} without saving your changes?`,
      confirmText: 'Discard',
      cancelText: 'Keep Editing',
      variant: 'danger',
    });

    if (confirmed) {
      discardSessionRef.current = true;
      onClose();
    }
  }, [filename, onClose, showConfirmDialog]);

  const openSearch = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    openSearchPanel(view);
  }, []);

  const openGoToLineDialog = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    setGoToLineValue(String(line));
    setGoToLineError(null);
    setShowGoToLine(true);
    requestAnimationFrame(() => {
      goToLineInputRef.current?.focus();
      goToLineInputRef.current?.select();
    });
  }, []);

  const handleGoToLine = useCallback(() => {
    const view = viewRef.current;
    const target = parseGoToLineInput(goToLineValue, view?.state.doc.lines ?? 1);
    if (!view || !target) {
      setGoToLineError('Enter a valid line number (or line:column).');
      return;
    }
    const lineNumber = target.line;
    const line = view.state.doc.line(lineNumber);
    const to = target.column ? Math.min(line.to, line.from + target.column - 1) : line.from;
    view.dispatch({
      selection: EditorSelection.cursor(to),
      scrollIntoView: true,
    });
    view.focus();
    setGoToLineError(null);
    setShowGoToLine(false);
    publishStatus(view.state);
  }, [goToLineValue, publishStatus]);

  const toggleLineComment = useCallback((view: EditorView) => {
    if (!lineCommentToken) return false;
    const changes = buildLineCommentChanges(
      view.state.doc.toString(),
      view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })),
      lineCommentToken,
    );
    if (!changes.length) return true;
    view.dispatch({ changes });
    return true;
  }, [lineCommentToken]);

  saveRef.current = handleSave;
  closeRef.current = handleClose;
  toggleCommentRef.current = toggleLineComment;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || viewRef.current) return;
    const initialTheme = createCodeMirrorTheme(resolvedThemeMode);

    const keyBindings = [
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          void saveRef.current();
          return true;
        },
      },
      {
        key: 'Mod-/',
        run: (view: EditorView) => toggleCommentRef.current(view),
      },
      {
        key: 'Mod-Shift-7',
        run: (view: EditorView) => toggleCommentRef.current(view),
      },
      {
        key: 'Mod-f',
        run: (view: EditorView) => {
          openSearchPanel(view);
          return true;
        },
      },
      {
        key: 'Mod-g',
        run: () => {
          openGoToLineDialog();
          return true;
        },
      },
    ];

    const extensions: Extension[] = [
      ...createCodeMirrorExtensions({
        keyBindings,
        richEditing: performanceMode.kind === 'full',
        onUpdate: (update) => {
          if (update.docChanged) {
            const savedDocument = savedDocRef.current;
            updateDirtyState(savedDocument
              ? !update.state.doc.eq(savedDocument)
              : true);
          }

          if (update.docChanged || update.selectionSet) {
            publishStatus(update.state);
          }
        },
      }),
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (isCommentShortcut(event)) {
            event.preventDefault();
            return toggleCommentRef.current(view);
          }

          return false;
        },
      }),
      languageCompartment.of([]),
      themeCompartment.of([
        initialTheme,
        syntaxHighlighting(createCodeMirrorHighlightStyle(resolvedThemeMode), { fallback: true }),
      ]),
    ];

    const cachedSession = takeCodeMirrorSession(sessionKey);
    let restoredSession: typeof cachedSession = null;
    let state: EditorState;

    if (cachedSession?.savedContent === initialContent) {
      try {
        state = EditorState.fromJSON(
          cachedSession.state,
          { extensions },
          { history: historyField },
        );
        restoredSession = cachedSession;
      } catch {
        state = EditorState.create({ doc: initialContent, extensions });
      }
    } else {
      state = EditorState.create({ doc: initialContent, extensions });
    }

    const view = new EditorView({
      state,
      parent: container,
    });

    viewRef.current = view;
    savedDocRef.current = view.state.toText(restoredSession?.savedContent ?? initialContent);
    updateDirtyState(!view.state.doc.eq(savedDocRef.current));
    discardSessionRef.current = false;
    publishStatus(view.state);
    requestAnimationFrame(() => {
      if (restoredSession) {
        view.scrollDOM.scrollLeft = restoredSession.scrollLeft;
        view.scrollDOM.scrollTop = restoredSession.scrollTop;
      }
      view.focus();
    });

    return () => {
      if (statusFrameRef.current !== null) {
        cancelAnimationFrame(statusFrameRef.current);
        statusFrameRef.current = null;
      }
      if (discardSessionRef.current) {
        deleteCodeMirrorSession(sessionKey);
      } else {
        saveCodeMirrorSession(sessionKey, {
          savedContent: savedDocRef.current?.toString() ?? initialContent,
          scrollLeft: view.scrollDOM.scrollLeft,
          scrollTop: view.scrollDOM.scrollTop,
          state: view.state.toJSON({ history: historyField }),
        });
      }

      view.destroy();
      viewRef.current = null;
      savedDocRef.current = null;
    };
  }, [filename, openGoToLineDialog, performanceMode.kind, publishStatus, sessionKey, updateDirtyState]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: languageCompartment.reconfigure([]),
    });

    if (performanceMode.kind === 'large-file') return;

    let cancelled = false;
    void loadCodeMirrorLanguage(filename)
      .then((language) => {
        if (cancelled || viewRef.current !== view) return;
        view.dispatch({
          effects: languageCompartment.reconfigure(language),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        showToast('warning', `Syntax support could not be loaded: ${message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [filename, languageCompartment, performanceMode.kind, showToast]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure([
        createTheme(),
        syntaxHighlighting(createCodeMirrorHighlightStyle(resolvedThemeMode), { fallback: true }),
      ])
    });
  }, [createTheme, resolvedThemeMode, themeCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === initialContent) {
      savedDocRef.current = view.state.doc;
      updateDirtyState(false);
      publishStatus(view.state);
      return;
    }

    if (savedDocRef.current?.toString() === initialContent) {
      return;
    }

    const applyIncomingContent = () => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: initialContent,
        },
        annotations: Transaction.addToHistory.of(false),
      });
      savedDocRef.current = view.state.doc;
      updateDirtyState(false);
      publishStatus(view.state);
    };

    if (!isDirtyRef.current) {
      applyIncomingContent();
      return;
    }

    let cancelled = false;
    void (async () => {
      const confirmed = await showConfirmDialog({
        title: 'Replace unsaved changes?',
        message: `${filename} has unsaved edits. Reload incoming content and discard current edits?`,
        confirmText: 'Reload',
        cancelText: 'Keep Editing',
        variant: 'danger',
      });
      if (!confirmed || cancelled) return;
      applyIncomingContent();
    })();

    return () => {
      cancelled = true;
    };
  }, [filename, initialContent, publishStatus, showConfirmDialog, updateDirtyState]);

  useEffect(() => {
    const focusEditor = () => viewRef.current?.focus();
    requestAnimationFrame(focusEditor);
    const timer = window.setTimeout(focusEditor, 60);
    return () => window.clearTimeout(timer);
  }, [filename]);

  useEffect(() => () => clearEditorStatus(statusSourceRef.current), []);

  return (
    <div
      className="absolute inset-0 z-[70] flex min-h-0 flex-col bg-app-panel"
      onKeyDownCapture={(event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'w') return;

        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
        void closeRef.current();
      }}
    >
      {!hideToolbar && (
        <CodeMirrorToolbar
          filename={filename}
          isDirty={isDirty}
          isSaving={isSaving}
          onClose={() => { void closeRef.current(); }}
          onGoToLine={openGoToLineDialog}
          onOpenSearch={openSearch}
          onSave={() => { void saveRef.current(); }}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {performanceMode.kind === 'large-file' && (
          <div className="border-b border-app-border bg-app-surface/40 px-3 py-1.5 text-xs text-app-muted">
            Large-file mode: syntax analysis, folding, and completion are paused to keep editing responsive.
          </div>
        )}

        {showGoToLine && (
          <GoToLinePanel
            error={goToLineError}
            inputRef={goToLineInputRef}
            maxLine={viewRef.current?.state.doc.lines ?? 1}
            value={goToLineValue}
            onCancel={() => {
              setShowGoToLine(false);
              setGoToLineError(null);
              requestAnimationFrame(() => viewRef.current?.focus());
            }}
            onChange={(value) => {
              setGoToLineValue(value);
              if (goToLineError) setGoToLineError(null);
            }}
            onSubmit={handleGoToLine}
          />
        )}

        <div
          className="min-h-0 flex-1 overflow-hidden bg-app-bg"
          onMouseDown={(event) => {
            event.stopPropagation();
            const target = event.target as HTMLElement | null;
            if (target?.closest('.cm-panels')) return;
            requestAnimationFrame(() => viewRef.current?.focus());
          }}
          onClick={(event) => {
            event.stopPropagation();
            const target = event.target as HTMLElement | null;
            if (target?.closest('.cm-panels')) return;
            viewRef.current?.focus();
          }}
        >
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
