import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';

interface PaneDocumentRegistration {
    id: string;
    url: string;
}

type PaneDocumentState =
    | { status: 'loading' }
    | { status: 'ready'; url: string }
    | { status: 'error' };

/**
 * Registers a pane document only while its frame is mounted. Native panes use
 * a separate document origin; the srcDoc fallback is for browser-only previews.
 */
export function usePluginPaneDocument(html: string, pluginId: string, panelId: string, legacyAccess: boolean): {
    native: boolean;
    state: PaneDocumentState;
} {
    const args = useMemo(() => ({
        html,
        pluginId,
        panelId,
        legacyAccess,
    }), [html, legacyAccess, panelId, pluginId]);
    return usePluginDocument('plugins_pane_document_register', args);
}

/** Register an editor provider against its manifest-declared package entry. */
export function usePluginEditorDocument(html: string, pluginId: string, enabled = true): {
    native: boolean;
    state: PaneDocumentState;
} {
    const args = useMemo(() => ({ html, pluginId }), [html, pluginId]);
    return usePluginDocument('plugins_editor_document_register', args, enabled);
}

function usePluginDocument(
    command: 'plugins_pane_document_register' | 'plugins_editor_document_register',
    args: Record<string, unknown>,
    enabled = true,
): { native: boolean; state: PaneDocumentState } {
    const native = isTauri() && enabled;
    const [state, setState] = useState<PaneDocumentState>({ status: 'loading' });

    useEffect(() => {
        if (!native) return;
        let disposed = false;
        let documentId: string | null = null;
        setState({ status: 'loading' });

        const unregister = (id: string) => {
            void invoke('plugins_pane_document_unregister', { id }).catch(() => {
                // The document is in-memory and also disappears when Zync exits.
            });
        };

        void invoke<PaneDocumentRegistration>(command, args)
            .then(registration => {
                documentId = registration.id;
                if (disposed) unregister(registration.id);
                else setState({ status: 'ready', url: registration.url });
            })
            .catch(() => {
                if (!disposed) setState({ status: 'error' });
            });

        return () => {
            disposed = true;
            if (documentId) unregister(documentId);
        };
    }, [args, command, native]);

    return { native, state };
}
