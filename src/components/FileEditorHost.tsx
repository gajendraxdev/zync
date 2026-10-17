import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { EditorPluginFrame } from './EditorPluginFrame';
import { BUILTIN_PLAIN_EDITOR_ID, CODEMIRROR_EDITOR_ID } from './editor/providers';
import { PlainFileEditor } from './PlainFileEditor';
import { usePlugins } from '../context/PluginContext';
import { useAppStore } from '../store/useAppStore';
import { useEditorSaveAccess, type EditorPermissionTarget } from '../features/files/application/useEditorSaveAccess';

const CodeMirrorFileEditor = lazy(async () => {
  const module = await import('./CodeMirrorFileEditor');
  return { default: module.CodeMirrorFileEditor };
});

interface FileEditorHostProps {
  documentId?: string;
  filename: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  preferredProviderId?: string;
  /**
   * When true, hides provider toolbar/header chrome.
   * Used by embedded/editor-with-parent-toolbar surfaces.
   */
  hideToolbar?: boolean;
  permissionTarget?: EditorPermissionTarget;
}

/**
 * Shared provider and save-access boundary. Built-in and community editors use
 * the same document policy; missing/broken providers retain the plain fallback.
 */
export function FileEditorHost(props: FileEditorHostProps) {
  const { access: saveAccess, save } = useEditorSaveAccess(props.permissionTarget, props.onSave);
  const editorProps = { ...props, onSave: save, saveAccess };
  const { editorProviders, plugins } = usePlugins();
  const defaultProvider = useAppStore((state) => state.settings.editor.defaultProvider);
  const showToast = useAppStore((state) => state.showToast);
  const [degradedProviderId, setDegradedProviderId] = useState<string | null>(null);
  const warnedFallbacksRef = useRef<Set<string>>(new Set());

  const providerId = props.preferredProviderId || defaultProvider || CODEMIRROR_EDITOR_ID;
  const selectedProvider = useMemo(
    () => editorProviders.find((plugin) => plugin.manifest.id === providerId) ?? null,
    [editorProviders, providerId]
  );
  const selectedProviderAnyState = useMemo(
    () => plugins.find((plugin) => plugin.manifest.id === providerId && plugin.manifest.type === 'editor-provider') ?? null,
    [plugins, providerId]
  );

  useEffect(() => {
    setDegradedProviderId(null);
  }, [providerId, props.filename]);

  const fallbackReason = useMemo(() => {
    if (providerId === BUILTIN_PLAIN_EDITOR_ID) return null;
    if (degradedProviderId && degradedProviderId === providerId) return 'runtime-failure';
    if (!selectedProviderAnyState) return 'missing-provider';
    if (!selectedProviderAnyState.enabled) return 'provider-disabled';
    if (!selectedProviderAnyState.editorHtml && selectedProviderAnyState.manifest.id !== CODEMIRROR_EDITOR_ID) {
      return 'missing-entry';
    }
    return null;
  }, [degradedProviderId, providerId, selectedProviderAnyState]);

  useEffect(() => {
    if (!fallbackReason || providerId === BUILTIN_PLAIN_EDITOR_ID) return;
    const warningKey = `${providerId}:${fallbackReason}`;
    if (warnedFallbacksRef.current.has(warningKey)) return;
    warnedFallbacksRef.current.add(warningKey);
    const providerName = selectedProviderAnyState?.manifest.name || providerId;
    const reasonText = fallbackReason === 'runtime-failure'
      ? 'it reported a runtime error'
      : fallbackReason === 'provider-disabled'
        ? 'it is currently disabled'
        : fallbackReason === 'missing-entry'
          ? 'it does not expose an editor entry'
          : 'it is not available';
    showToast('info', `Falling back to Built-in Fallback for ${providerName} (${reasonText}).`);
  }, [fallbackReason, providerId, selectedProviderAnyState?.manifest.name, showToast]);

  if (providerId === BUILTIN_PLAIN_EDITOR_ID) {
    return <PlainFileEditor {...editorProps} />;
  }

  if (fallbackReason) {
    return <PlainFileEditor {...editorProps} />;
  }

  if (selectedProvider?.manifest.id === CODEMIRROR_EDITOR_ID) {
    return (
      <Suspense
        fallback={(
          <div className="absolute inset-0 z-[70] flex items-center justify-center bg-app-panel text-sm text-app-muted">
            Loading built-in editor…
          </div>
        )}
      >
        <CodeMirrorFileEditor {...editorProps} />
      </Suspense>
    );
  }

  if (selectedProvider?.editorHtml) {
    return (
      <EditorPluginFrame
        plugin={selectedProvider}
        onFatalError={() => setDegradedProviderId(selectedProvider.manifest.id)}
        {...editorProps}
      />
    );
  }

  return <PlainFileEditor {...editorProps} />;
}
