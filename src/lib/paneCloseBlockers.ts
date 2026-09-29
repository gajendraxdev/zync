import { collectLeaves, type PaneContent, type PaneLayout } from './paneLayout';

const blockers = new Map<string, Set<object>>();

export function paneCloseScope(connectionId: string, content: PaneContent): string | null {
  if (content.kind === 'term') return null;
  const identity = content.instanceId ?? (content.kind === 'feature'
    ? `feature:${content.featureId}`
    : `plugin:${content.pluginId}`);
  return `${connectionId}\0${identity}`;
}

export function registerPaneCloseBlocker(scope: string, token: object): () => void {
  const registered = blockers.get(scope) ?? new Set<object>();
  registered.add(token);
  blockers.set(scope, registered);
  return () => {
    registered.delete(token);
    if (registered.size === 0) blockers.delete(scope);
  };
}

export function isPaneCloseBlocked(scope: string | null): boolean {
  return scope !== null && (blockers.get(scope)?.size ?? 0) > 0;
}

export function isPaneLayoutCloseBlocked(connectionId: string, layout: PaneLayout): boolean {
  return collectLeaves(layout.root).some(({ content }) =>
    isPaneCloseBlocked(paneCloseScope(connectionId, content)));
}
