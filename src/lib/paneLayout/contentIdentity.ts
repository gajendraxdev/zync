import type { PaneContent } from './types';

/**
 * Stable identity shared by retained hosts and presentation metadata.
 *
 * Moving content or promoting a canvas owner must not change this key. Legacy
 * feature/plugin panes without an instance ID use their persisted leaf ID; the
 * fallback is never a tree position, display title or mutable layout owner.
 */
export function paneContentKey(content: PaneContent, legacyPaneId: string): string {
    if (content.kind === 'term') return JSON.stringify([content.kind, content.termId]);
    const reference = content.kind === 'feature' ? content.featureId : content.pluginId;
    return JSON.stringify([content.kind, reference, content.instanceId ?? legacyPaneId]);
}
