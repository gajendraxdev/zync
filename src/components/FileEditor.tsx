import { useAppStore } from '../store/useAppStore';
import { AlertTriangle, Loader2, Save, X } from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { defineZyncTheme, ZYNC_THEME_NAME } from '../theme/monacoTheme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileEditorProps {
  filename: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

// ─── Language Detection ────────────────────────────────────────────────────────

/**
 * Maps file extension → Monaco language ID.
 * Monaco uses its own IDs (slightly different from file extensions).
 */
function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const fnameLower = filename.toLowerCase();
  const MAP: Record<string, string> = {
    // Web
    js: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less',
    // Config
    json: 'json', jsonc: 'json',
    yaml: 'yaml', yml: 'yaml',
    toml: 'ini',
    xml: 'xml',
    // Systems
    rs: 'rust',
    go: 'go',
    py: 'python',
    rb: 'ruby',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    // Shell
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    ps1: 'powershell',
    // Infrastructure
    tf: 'hcl',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    // Docs
    md: 'markdown', markdown: 'markdown',
    rst: 'restructuredtext',
    // Data / Query
    sql: 'sql', graphql: 'graphql',
    // Misc
    lua: 'lua', r: 'r',
  };
  return MAP[ext] ?? MAP[fnameLower] ?? 'plaintext';
}

/**
 * Maps Monaco language ID → Context Engine language key.
 * The context engine uses lowercase file-extension-style keys.
 */
function getContextEngineKey(monacoLang: string): string | null {
  const MAP: Record<string, string> = {
    javascript: 'javascript', typescript: 'typescript',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', yaml: 'yaml', xml: 'xml',
    rust: 'rust', go: 'go', python: 'python', ruby: 'ruby',
    c: 'c', cpp: 'cpp', csharp: 'csharp', java: 'java',
    kotlin: 'kotlin', swift: 'swift',
    shell: 'shell', powershell: 'powershell',
    markdown: 'markdown', sql: 'sql', graphql: 'graphql',
    dockerfile: 'dockerfile', hcl: 'hcl',
    lua: 'lua', r: 'r',
  };
  return MAP[monacoLang] ?? null;
}

// ─── Context Engine Integration ────────────────────────────────────────────────

/** Tracks which language providers have already been registered to avoid duplicates */
const registeredLanguages = new Set<string>();

async function registerContextEngineProviders(
  monaco: Monaco,
  monacoLangId: string,
): Promise<void> {
  const key = getContextEngineKey(monacoLangId);
  if (!key || registeredLanguages.has(key)) return;
  registeredLanguages.add(key);

  // Lazy-load only the JSON files we need for this specific language.
  // @vite-ignore is required because Vite can't statically analyze template-literal
  // imports across package boundaries — these resolve correctly at runtime.
  const [completionMod, hoverMod, definitionMod] = await Promise.allSettled([
    import(/* @vite-ignore */ `@enjoys/context-engine/completion/${key}.json`),
    import(/* @vite-ignore */ `@enjoys/context-engine/hover/${key}.json`),
    import(/* @vite-ignore */ `@enjoys/context-engine/definition/${key}.json`),
  ]);

  // ── Completions ──────────────────────────────────────────────────────────────
  if (completionMod.status === 'fulfilled' && completionMod.value?.completions) {
    const completions = completionMod.value.completions as any[];
    monaco.languages.registerCompletionItemProvider(monacoLangId, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provideCompletionItems(model: any, position: any) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: completions.map((item) => ({
            label: item.label,
            kind: item.kind,
            detail: item.detail,
            documentation: item.documentation?.value
              ? { value: item.documentation.value, isTrusted: true }
              : undefined,
            insertText: item.insertText ?? item.label,
            insertTextRules: item.insertTextRules,
            sortText: item.sortText,
            range,
          })),
        };
      },
    });
  }

  // ── Hover ───────────────────────────────────────────────────────────────────
  if (hoverMod.status === 'fulfilled' && hoverMod.value?.hovers) {
    const hovers = hoverMod.value.hovers as Record<string, any>;
    monaco.languages.registerHoverProvider(monacoLangId, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provideHover(model: any, position: any) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const hover = hovers[word.word.toLowerCase()];
        if (!hover) return null;
        return {
          range: new monaco.Range(
            position.lineNumber, word.startColumn,
            position.lineNumber, word.endColumn,
          ),
          contents: hover.contents?.map((c: any) => ({
            value: c.value,
            isTrusted: true,
            supportThemeIcons: true,
          })) ?? [],
        };
      },
    });
  }

  // ── Definitions ─────────────────────────────────────────────────────────────
  if (definitionMod.status === 'fulfilled' && definitionMod.value?.definitions) {
    const definitions = definitionMod.value.definitions as Record<string, any>;
    monaco.languages.registerDefinitionProvider(monacoLangId, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provideDefinition(model: any, position: any) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const def = definitions[word.word.toLowerCase()];
        if (!def) return null;
        const text = model.getValue();
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const col = lines[i].indexOf(word.word);
          if (col !== -1) {
            return {
              uri: model.uri,
              range: new monaco.Range(i + 1, col + 1, i + 1, col + 1 + word.word.length),
            };
          }
        }
        return null;
      },
    });
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FileEditor({ filename, initialContent, onSave, onClose }: FileEditorProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [showGoToLine, setShowGoToLine] = useState(false);
  const [targetLine, setTargetLine] = useState('');

  const sizeRef = useRef<HTMLSpanElement>(null);
  const sizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasChangesRef = useRef(false);
  const isSavingRef = useRef(false);
  const contentRef = useRef(initialContent);
  const initialContentRef = useRef(initialContent);

  // Stable ref to the Monaco editor instance for imperative operations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  // Keep a ref to the monaco namespace so we can create/dispose models outside onMount
  const monacoRef = useRef<any>(null);

  // theme is used by the Monaco theme definition (kept for reactivity if we need it later)
  const _theme = useAppStore((state) => state.settings.theme); void _theme;
  const language = detectLanguage(filename);

  // Keep refs in sync
  useEffect(() => { isSavingRef.current = isSaving; }, [isSaving]);
  useEffect(() => { hasChangesRef.current = hasChanges; }, [hasChanges]);

  // ── File Switch: swap Monaco model instead of re-mounting the editor ───────
  // Re-mounting the editor (via key={filename}) spawns a new worker thread per
  // file. Swapping models reuses the same worker and is ~10x more memory efficient.
  useEffect(() => {
    contentRef.current = initialContent;
    initialContentRef.current = initialContent;
    setHasChanges(false);
    hasChangesRef.current = false;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    // Create a new model for this file (unique URI prevents Monaco confusion)
    const lang = detectLanguage(filename);
    const uri = monaco.Uri.parse(`file:///${filename.replace(/\\/g, '/')}`);

    // If a model for this URI already exists (hot-reload/fast-switch), reuse it
    const existingModel = monaco.editor.getModel(uri);
    if (existingModel) {
      existingModel.setValue(initialContent);
      monaco.editor.setModelLanguage(existingModel, lang);
      editor.setModel(existingModel);
    } else {
      // Create a fresh model and attach it — no editor re-mount needed
      const newModel = monaco.editor.createModel(initialContent, lang, uri);
      editor.setModel(newModel);
    }
    
    editor.focus();

    // Re-load Context Engine providers for the new language
    registerContextEngineProviders(monaco, lang).catch(console.error);
  }, [filename, initialContent]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  // This is the primary memory fix: dispose the model when the editor closes
  // so Monaco's internal heap releases the 60-100MB of text data it holds.
  useEffect(() => {
    return () => {
      // Clear global status text on close
      const el = document.getElementById('global-editor-status');
      if (el) el.textContent = '';

      if (sizeTimeoutRef.current) clearTimeout(sizeTimeoutRef.current);

      const editor = editorRef.current;
      if (editor) {
        const model = editor.getModel();
        // Dispose the model first, then the editor itself
        try { model?.dispose(); } catch (_) { /* ignore */ }
        try { editor.dispose(); } catch (_) { /* ignore */ }
        editorRef.current = null;
      }
    };
  }, []);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!hasChangesRef.current || isSavingRef.current) return;
    setIsSaving(true);
    try {
      await onSave(contentRef.current);
      setHasChanges(false);
      hasChangesRef.current = false;
    } catch (error) {
      console.error('[FileEditor] Save failed:', error);
    } finally {
      setIsSaving(false);
    }
  }, [onSave]);

  const saveRef = useRef(handleSave);
  useEffect(() => { saveRef.current = handleSave; }, [handleSave]);

  const handleClose = () => {
    if (hasChangesRef.current) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  // ── Monaco onMount ──────────────────────────────────────────────────────────
  const handleEditorMount: OnMount = useCallback(
    async (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // ── Create the initial model ───────────────────────────────────────────
      // We must do this here, NOT in a useEffect, because the file-switch
      // useEffect runs BEFORE onMount fires, so monacoRef is still null then.
      const initialUri = monaco.Uri.parse(
        `file:///${filename.replace(/\\/g, '/')}`,
      );
      // If a model for this URI already exists (hot-reload), reuse it
      const existingModel = monaco.editor.getModel(initialUri);
      const initialModel = existingModel
        ?? monaco.editor.createModel(initialContent, language, initialUri);

      editor.setModel(initialModel);

      // Define & apply the Zync theme
      defineZyncTheme(monaco);
      monaco.editor.setTheme(ZYNC_THEME_NAME);

      // ── Keyboard shortcuts ────────────────────────────────────────────────
      // Ctrl/Cmd + S → Save
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => saveRef.current(),
      );

      // Ctrl/Cmd + Shift + G → Go to Line
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyG,
        () => setShowGoToLine(true),
      );

      // ── Cursor / size status bar ─────────────────────────────────────────
      const updateGlobalStatus = (line: number, col: number) => {
        const el = document.getElementById('global-editor-status');
        if (el) {
          el.textContent = `${filename} Ln ${line}, Col ${col} UTF-8 Tab: 2 {} ${language.toUpperCase()}`;
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.onDidChangeCursorPosition((e: any) => {
        updateGlobalStatus(e.position.lineNumber, e.position.column);
      });
      // Set initial status
      updateGlobalStatus(1, 1);

      editor.onDidChangeModelContent(() => {
        const val = editor.getValue();
        contentRef.current = val;
        // Compare against initialContentRef.current to avoid closing over stale props
        const changed = val !== initialContentRef.current;
        setHasChanges((prev) => (prev === changed ? prev : changed));
        hasChangesRef.current = changed;

        // Debounced byte-size update
        if (sizeTimeoutRef.current) clearTimeout(sizeTimeoutRef.current);
        sizeTimeoutRef.current = setTimeout(() => {
          if (sizeRef.current) {
            const bytes = new TextEncoder().encode(val).length;
            sizeRef.current.textContent = `${(bytes / 1024).toFixed(1)} KB`;
          }
        }, 300);
      });

      // ── Context Engine: lazy-load language providers ─────────────────────
      await registerContextEngineProviders(monaco, language);

      // Focus the editor after mount
      editor.focus();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );

  // ── Before Monaco mounts: register theme ─────────────────────────────────
  const handleBeforeMount = useCallback((monaco: Monaco) => {
    defineZyncTheme(monaco);
  }, []);

  // ── Go to Line ──────────────────────────────────────────────────────────────
  const handleGoToLine = useCallback(() => {
    const lineNum = parseInt(targetLine, 10);
    if (isNaN(lineNum) || !editorRef.current) return;
    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;
    const safeLineNum = Math.max(1, Math.min(lineNum, model.getLineCount()));
    editor.revealLineInCenter(safeLineNum);
    editor.setPosition({ lineNumber: safeLineNum, column: 1 });
    editor.focus();
    setShowGoToLine(false);
    setTargetLine('');
  }, [targetLine]);



  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="absolute inset-0 z-50 bg-app-bg flex flex-col animate-in fade-in duration-200"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Floating Actions ────────────────────────────────────────────── */}
      <div className="absolute top-4 right-6 z-10 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          title="Save (Ctrl+S)"
          aria-label="Save"
          className="h-8 w-8 flex items-center justify-center rounded-full bg-app-panel/90 text-app-text backdrop-blur hover:bg-app-accent hover:text-white transition-all shadow-sm border border-app-border disabled:opacity-0 disabled:pointer-events-none"
        >
          {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        </button>
        <button
          onClick={handleClose}
          title="Close"
          aria-label="Close"
          className="h-8 w-8 flex items-center justify-center rounded-full bg-app-panel/90 text-app-text backdrop-blur hover:bg-app-danger hover:text-white transition-all shadow-sm border border-app-border"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Monaco Editor ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative">
        <Editor
          language={language}
          theme={ZYNC_THEME_NAME}
          beforeMount={handleBeforeMount}
          onMount={handleEditorMount}
          options={{
            // Font
            fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
            fontSize: 13,
            fontLigatures: true,
            lineHeight: 22,

            // Layout
            minimap: { enabled: true, side: 'right', scale: 1 },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            tabSize: 2,
            insertSpaces: true,

            // Intelligence
            quickSuggestions: { other: true, comments: false, strings: false },
            suggestOnTriggerCharacters: true,
            parameterHints: { enabled: true },
            inlayHints: { enabled: 'on' },
            hover: { enabled: true, delay: 300 },

            // UX
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: 'active', indentation: true },
            renderLineHighlight: 'all',
            occurrencesHighlight: 'singleFile',

            // Accessibility
            accessibilitySupport: 'auto',

            // Scrollbars
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },

            // Padding (so code doesn't hug the very top)
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>



      {/* ── Go To Line Modal ─────────────────────────────────────────────── */}
      <Modal
        isOpen={showGoToLine}
        onClose={() => setShowGoToLine(false)}
        title="Go to Line"
        width="max-w-[280px]"
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="goToLineInput" className="text-[11px] font-medium text-app-muted uppercase tracking-wider">
              Line Number
            </label>
            <input
              id="goToLineInput"
              autoFocus
              type="text"
              placeholder="e.g. 42"
              value={targetLine}
              onChange={(e) => setTargetLine(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && handleGoToLine()}
              className="w-full bg-app-surface border border-app-border rounded px-3 py-2 text-sm text-app-text outline-none focus:border-app-accent transition-colors"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowGoToLine(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleGoToLine} className="px-6">
              Go
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Unsaved Changes Confirmation Modal ───────────────────────────── */}
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
                You have unsaved changes in{' '}
                <span className="text-app-text font-mono underline decoration-app-accent/30">
                  {filename}
                </span>
                . Closing will lose all modifications.
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
