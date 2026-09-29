import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';

import { useAppStore } from '../store/useAppStore';
import type { Plugin } from '../context/PluginContext';
import { getZyncThemePayload } from '../lib/themePayload';
import { isDebugThemePayloadEnabled } from '../lib/debugFlags';
import { PluginSaveState } from './editor/pluginSaveState';
import { parseEditorStatusReport, type EditorStatusReport } from './editor/editorStatusReport';
import { clearEditorStatus, createEditorStatusSource, publishEditorStatus } from '../features/editor/editorStatus';
import { formatCodeMirrorStatus } from './editor/codemirror/status';
import { usePluginEditorDocument } from '../features/plugins/usePluginPaneDocument';

interface EditorPluginFrameProps {
  plugin: Plugin;
  documentId?: string;
  filename: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  hideToolbar?: boolean;
  onFatalError?: (reason: string) => void;
}

interface EditorDocumentPayload {
  docId: string;
  path: string;
  filename: string;
  language: string;
  content: string;
  readOnly: boolean;
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    rs: 'rust',
    xml: 'xml',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
  };

  return map[ext] ?? 'plaintext';
}

export function EditorPluginFrame({
  plugin,
  documentId,
  filename,
  initialContent,
  onSave,
  onClose,
  onDirtyChange,
  hideToolbar = false,
  onFatalError,
}: EditorPluginFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [statusReport, setStatusReport] = useState<EditorStatusReport | null>(null);
  const statusSourceRef = useRef(createEditorStatusSource(`plugin-editor:${plugin.manifest.id}`));
  const theme = useAppStore((state) => state.settings.theme);
  const accentColor = useAppStore((state) => state.settings.accentColor);
  const showToast = useAppStore((state) => state.showToast);
  const showConfirmDialog = useAppStore((state) => state.showConfirmDialog);
  const saveStateRef = useRef(new PluginSaveState(initialContent));
  const readyForDocRef = useRef(false);
  const currentDocIdRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const setEditorDirty = useCallback((value: boolean) => {
    saveStateRef.current.dirty = value;
    setDirty(value);
    onDirtyChange?.(value);
  }, [onDirtyChange]);

  const doc = useMemo<EditorDocumentPayload>(() => ({
    docId: `file-editor:${documentId ?? filename}`,
    path: filename,
    filename,
    language: detectLanguage(filename),
    content: initialContent,
    readOnly: false,
  }), [documentId, filename, initialContent]);

  useEffect(() => {
    const report = statusReport?.docId === doc.docId ? statusReport : null;
    publishEditorStatus(
      statusSourceRef.current,
      report
        ? formatCodeMirrorStatus(filename, report.line, report.column, report.language ?? doc.language, dirty)
        : `${filename}  UTF-8  ${doc.language}${dirty ? '  • Modified' : ''}`,
    );
  }, [dirty, doc.docId, doc.language, filename, statusReport]);

  useEffect(() => () => clearEditorStatus(statusSourceRef.current), []);

  const requestClose = useCallback(async () => {
    if (!saveStateRef.current.dirty) {
      onClose();
      return;
    }

    if (await showConfirmDialog({
      title: 'Discard unsaved changes?',
      message: `Close ${filename} without saving changes from ${plugin.manifest.name}?`,
      confirmText: 'Discard',
      cancelText: 'Keep Editing',
      variant: 'danger',
    })) {
      onClose();
    }
  }, [filename, onClose, plugin.manifest.name, showConfirmDialog]);

  const postToFrame = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  // Always compute the current theme payload at send-time so we don't
  // accidentally capture stale CSS variable values.
  const getThemePayload = useCallback(() => getZyncThemePayload(theme), [theme, accentColor]);

  const sendTheme = useCallback(() => {
    const themePayload = getThemePayload();
    if (isDebugThemePayloadEnabled()) {
      // eslint-disable-next-line no-console
      console.debug('[EditorPluginFrame] theme payload', themePayload);
    }
    postToFrame({
      type: 'zync:editor:set-theme',
      payload: themePayload,
    });
  }, [getThemePayload, postToFrame]);

  useEffect(() => {
    if (!isReady) return;
    sendTheme();
  }, [isReady, sendTheme]);

  useEffect(() => {
    saveStateRef.current.reset(initialContent);
    setEditorDirty(false);
    setSaveError(null);
    // A content refresh for the same file must not clear in-flight edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.docId, setEditorDirty]);

  useEffect(() => {
    saveStateRef.current.refreshIfClean(initialContent);
  }, [initialContent]);

  useEffect(() => {
    if (!isReady || !readyForDocRef.current) return;

    const isSameDoc = currentDocIdRef.current === doc.docId;
    if (!isSameDoc || !saveStateRef.current.dirty) {
      postToFrame({
        type: isSameDoc ? 'zync:editor:update-document' : 'zync:editor:open-document',
        payload: isSameDoc ? { docId: doc.docId, content: doc.content } : doc,
      });
    }
    postToFrame({
      type: 'zync:editor:set-readonly',
      payload: {
        docId: doc.docId,
        readOnly: doc.readOnly,
      },
    });
    postToFrame({
      type: 'zync:editor:focus',
      payload: { docId: doc.docId },
    });
    currentDocIdRef.current = doc.docId;
  }, [doc, isReady, postToFrame]);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      try {
        if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
        const { type, payload } = event.data || {};

        switch (type) {
          case 'zync:editor:ready': {
            if (readyForDocRef.current) {
              sendTheme();
              break;
            }
            setIsReady(true);
            readyForDocRef.current = true;
            const themePayload = getThemePayload();
            postToFrame({
              type: 'zync:editor:init',
              payload: {
                pluginId: plugin.manifest.id,
                saveResults: true,
                sessionId: `editor-session:${doc.docId}`,
                capabilitiesRequested: plugin.manifest.editor?.supports ?? [],
                theme: themePayload,
              },
            });
            currentDocIdRef.current = null;
            sendTheme();
            break;
          }
          case 'zync:editor:change': {
            if (payload?.docId && payload.docId !== currentDocIdRef.current) break;
            setEditorDirty(saveStateRef.current.change(payload?.content));
            break;
          }
          case 'zync:editor:dirty-change':
            if (payload?.docId && payload.docId !== currentDocIdRef.current) break;
            setEditorDirty(saveStateRef.current.providerDirtyChange(Boolean(payload?.dirty)));
            break;
          case 'zync:editor:status': {
            if (!currentDocIdRef.current) break;
            const report = parseEditorStatusReport(payload, currentDocIdRef.current);
            if (report) setStatusReport((current) => (
              current?.docId === report.docId && current.line === report.line &&
              current.column === report.column && current.language === report.language
                ? current : report
            ));
            break;
          }
          case 'zync:editor:save-request':
            if (payload?.docId && payload.docId !== currentDocIdRef.current) break;
            {
              const content = saveStateRef.current.requestSave(payload?.content);
              setEditorDirty(saveStateRef.current.dirty);
              const requestId = typeof payload?.requestId === 'number' ? payload.requestId : undefined;
              const docId = currentDocIdRef.current;
              const save = async () => {
                try {
                  if (docId === currentDocIdRef.current) setSaveError(null);
                  await onSave(content);
                  if (docId === currentDocIdRef.current) {
                    setEditorDirty(saveStateRef.current.saveSucceeded(content, requestId !== undefined));
                    showToast('success', `${plugin.manifest.name} saved ${filename}`);
                  }
                  if (requestId !== undefined) postToFrame({
                    type: 'zync:editor:save-result',
                    payload: { docId, requestId, ok: true },
                  });
                } catch (error: unknown) {
                  const message = error instanceof Error ? error.message : String(error);
                  if (docId === currentDocIdRef.current) {
                    setSaveError(message);
                    setEditorDirty(saveStateRef.current.saveFailed(content));
                  }
                  showToast('error', `Plugin editor save failed: ${message}`);
                  if (requestId !== undefined) postToFrame({
                    type: 'zync:editor:save-result',
                    payload: { docId, requestId, ok: false },
                  });
                }
              };
              const queuedSave = saveQueueRef.current.then(save, save);
              saveQueueRef.current = queuedSave;
              await queuedSave;
            }
            break;
          case 'zync:editor:request-close':
            await requestClose();
            break;
          case 'zync:editor:error':
            if (payload?.message) {
              setLastError(payload.message);
              showToast(payload?.fatal ? 'error' : 'info', payload.message);
              if (payload?.fatal) {
                onFatalError?.(payload.message);
              }
            }
            break;
        }
      } catch (err) {
        console.error('EditorPluginFrame message handler error:', err);
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [doc.docId, filename, onFatalError, onSave, plugin.manifest.editor?.supports, plugin.manifest.id, plugin.manifest.name, postToFrame, requestClose, sendTheme, setEditorDirty, showToast]);

  useEffect(() => {
    return () => {
      postToFrame({
        type: 'zync:editor:dispose',
        payload: {
          docId: currentDocIdRef.current ?? undefined,
        },
      });
      readyForDocRef.current = false;
      currentDocIdRef.current = null;
    };
  }, [postToFrame]);

  const shimScript = useMemo(() => {
    const supportedCapabilitiesLiteral = JSON.stringify(
      plugin.manifest.editor?.supports ?? [],
    ).replace(/</g, '\\u003c');

    const resolverScript = `
  (function () {
    window.__zyncResolveEditorAsset = function (relativePath) {
      const value = String(relativePath || '');
      try {
        return new URL(value, document.baseURI).toString();
      } catch {
        return value;
      }
    };
  })();
    `;

    return `
<script>
(function () {
  ${resolverScript}

  const listeners = new Set();
  const supportedCapabilities = ${supportedCapabilitiesLiteral};
  window.zyncEditor = {
    onMessage(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    emitReady(payload = {}) {
      window.parent.postMessage({ type: 'zync:editor:ready', payload }, '*');
    },
    emitChange(payload = {}) {
      window.parent.postMessage({ type: 'zync:editor:change', payload }, '*');
    },
    emitDirtyChange(dirty, docId) {
      window.parent.postMessage({ type: 'zync:editor:dirty-change', payload: { dirty, docId } }, '*');
    },
    reportStatus(status) {
      window.parent.postMessage({ type: 'zync:editor:status', payload: status }, '*');
    },
    requestSave(content, request) {
      window.parent.postMessage({ type: 'zync:editor:save-request', payload: { content, ...request } }, '*');
    },
    requestClose() {
      window.parent.postMessage({ type: 'zync:editor:request-close', payload: {} }, '*');
    },
    reportError(code, message, fatal) {
      window.parent.postMessage({ type: 'zync:editor:error', payload: { code, message, fatal } }, '*');
    }
  };

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source === window.parent && message?.type === 'zync:editor:bootstrap') {
      window.zyncEditor.emitReady({ supports: supportedCapabilities });
    }
    listeners.forEach((listener) => {
      try { listener(message); } catch (error) { console.error(error); }
    });
    window.dispatchEvent(new CustomEvent('zync-editor-message', { detail: message }));
  });
})();
</script>
`;
  }, [plugin.manifest.editor?.supports]);

  const nativeEditorDocument = isTauri() && !plugin.path.startsWith('builtin://');
  const fullHtml = (plugin.editorHtml || plugin.style || plugin.script)
    ? (() => {
        let html = plugin.editorHtml || '<html><head></head><body></body></html>';
        const securityMeta = nativeEditorDocument ? '' : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; worker-src blob:; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
        const headInjection = `${securityMeta}${shimScript}${plugin.style ? `<style>${plugin.style}</style>` : ''}${plugin.script ? `<script>${plugin.script}</script>` : ''}`;

        if (/<head\b[^>]*>/i.test(html)) {
          return html.replace(/<head\b[^>]*>/i, (match) => `${match}${headInjection}`);
        }
        if (/<\/head>/i.test(html)) {
          return html.replace(/<\/head>/i, `${headInjection}</head>`);
        }
        return `<html><head>${headInjection}</head><body>${html}</body></html>`;
      })()
    : `<html><head>${shimScript}</head><body style="font-family: sans-serif; background: #111827; color: white; display:flex; align-items:center; justify-content:center; min-height:100vh;">No editor entry found.</body></html>`;
  const editorDocument = usePluginEditorDocument(fullHtml, plugin.manifest.id, nativeEditorDocument);

  return (
      <div className="absolute inset-0 z-[70] flex min-h-0 flex-col bg-app-panel">
        {!hideToolbar && (
          <div className="flex h-9 items-center justify-between border-b border-app-border bg-app-panel px-3">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-medium text-app-text">{filename}</h3>
              <span aria-hidden="true" className="text-app-muted/50">·</span>
              <span className="truncate text-xs text-app-muted">
                {plugin.manifest.editor?.displayName || plugin.manifest.name}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[11px] text-app-muted">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${isReady ? 'bg-emerald-400' : 'bg-amber-400'}`}
                />
                {isReady ? 'Ready' : 'Connecting'}
              </span>
              <span className={dirty ? 'text-app-text' : 'text-app-muted'}>
                {dirty ? 'Modified' : 'Saved'}
              </span>
              <button
                type="button"
                onClick={() => { void requestClose(); }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base text-app-muted transition-colors hover:bg-app-surface hover:text-app-text"
                aria-label="Close editor"
              >
                ×
              </button>
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
        {saveError && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            Save failed: {saveError}
          </div>
        )}
        {lastError && !saveError && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Editor warning: {lastError}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden bg-app-bg">
          {editorDocument.native && editorDocument.state.status === 'error' ? (
            <div role="alert" className="flex h-full items-center justify-center px-4 text-sm text-app-muted">
              Editor provider assets could not load. Close and reopen the file to try again.
            </div>
          ) : editorDocument.native && editorDocument.state.status === 'loading' ? (
            <div role="status" className="flex h-full items-center justify-center text-sm text-app-muted">
              Loading editor provider…
            </div>
          ) : <iframe
            ref={iframeRef}
            src={editorDocument.native && editorDocument.state.status === 'ready' ? editorDocument.state.url : undefined}
            srcDoc={editorDocument.native ? undefined : fullHtml}
            onLoad={() => {
              setIsReady(false);
              setStatusReport(null);
              readyForDocRef.current = false;
              currentDocIdRef.current = null;
              postToFrame({ type: 'zync:editor:bootstrap', payload: {} });
            }}
            // Keep plugin scripts running while giving srcDoc an opaque origin.
            // In particular, this prevents untrusted editor code from reading parent.document.
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-transparent"
            title={`Editor Provider: ${plugin.manifest.id}`}
          />}
        </div>
      </div>
    </div>
  );
}
