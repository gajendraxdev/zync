import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { yaml } from '@codemirror/lang-yaml';
import { keymap, EditorView } from '@codemirror/view';
import { searchKeymap, openSearchPanel } from '@codemirror/search';
import { toggleComment } from '@codemirror/commands';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useAppStore } from '../store/useAppStore';
import { AlertTriangle, FileCode, Loader2, Save, X } from 'lucide-react';
import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

interface FileEditorProps {
  filename: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

export function FileEditor({ filename, initialContent, onSave, onClose }: FileEditorProps) {
  // No more 'content' state to avoid re-renders on every keystroke
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const theme = useAppStore(state => state.settings.theme);

  // Custom Theme using Zync CSS variables
  const editorTheme = useMemo(() => {
    return EditorView.theme({
      "&": {
        backgroundColor: "var(--color-app-bg)",
        color: "var(--color-app-text)",
        height: "100%",
      },
      ".cm-content": {
        caretColor: "var(--color-app-accent)",
        fontFamily: "var(--font-mono)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--color-app-accent)"
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "rgba(121, 123, 206, 0.25) !important" // app-accent with opacity
      },
      ".cm-panels": {
        backgroundColor: "var(--color-app-panel)",
        color: "var(--color-app-text)",
        borderBottom: "1px solid var(--color-app-border)"
      },
      ".cm-panels.cm-panels-top": {
        borderBottom: "2px solid var(--color-app-border)"
      },
      ".cm-panels.cm-panels-bottom": {
        borderTop: "2px solid var(--color-app-border)"
      },
      ".cm-search": {
        backgroundColor: "var(--color-app-panel)",
        color: "var(--color-app-text)",
        borderBottom: "1px solid var(--color-app-border)",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        padding: "6px 10px !important",
        gap: "6px 12px"
      },
      ".cm-search input": {
        backgroundColor: "var(--color-app-bg) !important",
        color: "var(--color-app-text) !important",
        border: "1px solid var(--color-app-border) !important",
        borderRadius: "4px !important",
        padding: "2px 6px !important",
        fontSize: "12px !important",
        outline: "none !important"
      },
      ".cm-search input:focus": {
        borderColor: "var(--color-app-accent) !important",
      },
      ".cm-search label": {
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--color-app-muted)",
        display: "flex",
        alignItems: "center",
        gap: "4px"
      },
      ".cm-search .cm-button": {
        color: "var(--color-app-text) !important",
        backgroundColor: "var(--color-app-surface) !important",
        backgroundImage: "none !important",
        border: "1px solid var(--color-app-border) !important",
        borderRadius: "4px !important",
        padding: "2px 8px !important",
        fontSize: "11px !important",
        textTransform: "capitalize !important"
      },
      ".cm-search .cm-button:hover": {
        backgroundColor: "var(--color-app-bg) !important",
        borderColor: "var(--color-app-accent) !important"
      },
      ".cm-search .cm-button[name=close]": {
        backgroundColor: "transparent !important",
        border: "none !important",
        opacity: "0.6"
      },
      ".cm-search .cm-button[name=close]:hover": {
        opacity: "1",
        color: "var(--color-app-danger) !important"
      },
      ".cm-gutters": {
        backgroundColor: "var(--color-app-bg)", // Blend with background
        color: "var(--color-app-muted)",
        borderRight: "1px solid var(--color-app-border)"
      },
      ".cm-activeLine": {
        backgroundColor: "rgba(255, 255, 255, 0.03)"
      },
      ".cm-activeLineGutter": {
        backgroundColor: "rgba(255, 255, 255, 0.03)",
        color: "var(--color-app-text)"
      }
    }, { dark: theme === 'dark' });
  }, [theme]);

  // Refs for stability
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const contentRef = useRef(initialContent);

  useEffect(() => {
    contentRef.current = initialContent;
    setHasChanges(false);
  }, [initialContent]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave(contentRef.current);
      setHasChanges(false);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  }, [onSave]);

  const handleClose = async () => {
    if (hasChanges) {
      setShowConfirmClose(true);
      return;
    }
    onClose();
  };

  const onChange = useCallback(
    (val: string) => {
      contentRef.current = val;
      const isDifferent = val !== initialContent;
      // Only trigger a re-render if the 'hasChanges' status actually changes
      setHasChanges(prev => {
        if (prev === isDifferent) return prev;
        return isDifferent;
      });
    },
    [initialContent],
  );

  // Detect Language extension - Memoized for performance
  const extensions = useMemo(() => {
    const exts = [];
    const fileExt = filename.split('.').pop()?.toLowerCase();

    // 1. Language Support
    switch (fileExt) {
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
        exts.push(javascript({ jsx: true }));
        break;
      case 'html':
        exts.push(html());
        break;
      case 'css':
        exts.push(css());
        break;
      case 'json':
        exts.push(json());
        break;
      case 'py':
        exts.push(python());
        break;
      case 'md':
      case 'markdown':
        exts.push(markdown());
        break;
      case 'yml':
      case 'yaml':
        exts.push(yaml());
        break;
      case 'rs':
        exts.push(rust());
        break;
      case 'go':
        exts.push(go());
        break;
      case 'c':
      case 'cpp':
      case 'h':
      case 'hpp':
        exts.push(cpp());
        break;
    }

    // 2. Raw Event interceptor for ALL editor shortcuts
    // This catches events before they bubble to the browser or system
    exts.push(EditorView.domEventHandlers({
      keydown: (event, view) => {
        // Ctrl/Cmd + /
        if ((event.ctrlKey || event.metaKey) && event.key === '/') {
          event.preventDefault();
          event.stopPropagation();
          toggleComment(view);
          return true;
        }
        // Ctrl/Cmd + S
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
          event.preventDefault();
          event.stopPropagation();
          handleSave();
          return true;
        }
        // Ctrl/Cmd + F
        if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
          event.preventDefault();
          event.stopPropagation();
          openSearchPanel(view);
          return true;
        }
        return false;
      }
    }));

    // 3. Search Shortcuts (Ctrl + F)
    exts.push(keymap.of(searchKeymap));

    return exts;
  }, [filename, handleSave]);

  return (
    <div className="absolute inset-0 z-50 bg-app-bg flex flex-col animate-in fade-in duration-200">
      {/* Toolbar */}
      <div className="h-12 border-b border-app-border bg-app-panel flex items-center justify-between px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-app-surface flex items-center justify-center border border-app-border">
            <FileCode size={16} className="text-app-accent" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-app-text flex items-center gap-2">
              {filename}
              {hasChanges && <span className="h-2 w-2 rounded-full bg-app-accent animate-pulse" />}
            </span>
            <span className="text-[10px] text-app-muted">{hasChanges ? 'Unsaved changes' : 'All changes saved'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="w-24 gap-2"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </Button>
          <div className="h-4 w-px bg-app-border mx-2" />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="hover:bg-app-danger/20 hover:text-app-danger"
          >
            <X size={18} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative">
        <CodeMirror
          ref={editorRef}
          value={initialContent} // initialization only
          height="100%"
          theme={editorTheme}
          autoFocus={true}
          extensions={extensions}
          onChange={onChange}
          className="h-full text-base font-mono"
          basicSetup={{
            foldGutter: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            tabSize: 4,
          }}
        />
      </div>

      <Modal
        isOpen={showConfirmClose}
        onClose={() => setShowConfirmClose(false)}
        title="Unsaved Changes"
        width="max-w-sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-full bg-app-danger/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-app-danger" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-white">Discard changes?</p>
              <p className="text-sm text-app-muted leading-relaxed">
                You have unsaved changes in <span className="text-app-text font-mono underline decoration-app-accent/30">{filename}</span>. Closing will lose all modifications.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setShowConfirmClose(false)}
              className="px-4"
            >
              Keep Editing
            </Button>
            <Button
              variant="primary"
              onClick={onClose}
              className="bg-app-danger hover:bg-app-danger/90 text-white border-none px-4"
            >
              Discard Changes
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
