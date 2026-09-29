import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

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
    const native = isTauri();
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

        void invoke<PaneDocumentRegistration>('plugins_pane_document_register', { html, pluginId, panelId, legacyAccess })
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
    }, [html, native, pluginId, panelId, legacyAccess]);

    return { native, state };
}
