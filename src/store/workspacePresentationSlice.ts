import type { StateCreator } from 'zustand';
import type { AppStore } from './useAppStore';
import { collectLeaves } from '../lib/paneLayout';
import { paneContentKey } from '../lib/paneLayout/contentIdentity';
import { parseDisplayAliasDraft } from '../features/workspace/domain/presentation';
import { deriveWorkspaceContentInventory } from '../features/workspace/domain/contentInventory';
import {
    BUILTIN_WORKSPACE_VIEW_REGISTRATIONS,
    buildWorkspaceViewRegistry,
    type WorkspaceViewRegistry,
} from '../features/workspace/domain/registrations';
import {
    CONTENT_PRESENTATION_VERSION,
    MAX_PRESENTATION_ITEMS_PER_SCOPE,
    MAX_PRESENTATION_SCOPES,
    isContentPresentationKey,
    isPresentationScopeId,
    sortContentPresentation,
    type ContentPresentationItem,
    type ContentPresentationMap,
    type ContentPresentationScope,
} from '../features/workspace/domain/contentPresentation';

export interface WorkspacePresentationSlice {
    /** Per-connection decoration only; existing terminals and pane groups own lifetime. */
    contentPresentation: ContentPresentationMap;
    /** Validated transient capabilities from app/plugin composition, not live instances. */
    workspaceViewRegistry: WorkspaceViewRegistry;
    setWorkspaceViewRegistry: (registry: WorkspaceViewRegistry) => void;
    setContentDisplayAlias: (scopeId: string, contentKey: string, alias: string | undefined) => boolean;
    /** Instance pinning changes visual priority, never kind-level auto-open preferences. */
    setContentPinned: (scopeId: string, contentKey: string, pinned: boolean) => boolean;
    /** Metadata only: the application owns visible selection and keyboard-focus recovery. */
    setContentHidden: (scopeId: string, contentKey: string, hidden: boolean) => boolean;
    /** Reveal live and temporarily absent content in one write, preserving all other decoration. */
    revealAllContent: (scopeId: string) => boolean;
    /** Move one visual position within the current pin bucket; boundaries return false. */
    moveContent: (scopeId: string, contentKey: string, direction: -1 | 1) => boolean;
    /** Atomic strip drag: move a complete tab/split within its pin bucket. */
    reorderContent: (scopeId: string, source: readonly string[], target: readonly string[], after: boolean) => boolean;
    /** Restore canonical visual order while keeping aliases and instance pins. */
    resetContentOrder: (scopeId: string) => void;
    /** Call only after a guarded close actually removes these content instances. */
    forgetContentPresentation: (scopeId: string, contentKeys: readonly string[]) => void;
    /** Reset decoration without changing content, connections, layout or credentials. */
    resetContentPresentation: (scopeId: string) => void;
}

function hasOwn(record: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

/** Resolve live identity from authoritative state, including grouped/hidden content. */
function hasLiveContent(state: AppStore, scopeId: string, key: string): boolean {
    if (hasOwn(state.terminals, scopeId)
        && (state.terminals[scopeId] ?? []).some(term => paneContentKey({ kind: 'term', termId: term.id }, term.id) === key)) return true;
    if (!hasOwn(state.paneLayouts, scopeId)) return false;
    return Object.values(state.paneLayouts[scopeId] ?? {}).some(layout =>
        collectLeaves(layout.root).some(leaf => paneContentKey(leaf.content, leaf.id) === key));
}

export const createWorkspacePresentationSlice: StateCreator<AppStore, [], [], WorkspacePresentationSlice> = (set, get) => {
    const scopeFor = (state: AppStore, scopeId: string) =>
        hasOwn(state.contentPresentation, scopeId) ? state.contentPresentation[scopeId] : undefined;

    /** Restoration owns persisted metadata until its complete snapshot is ready. */
    const canWrite = (state: AppStore, scopeId: string) =>
        state.sessionLoaded && !state.isRestoring && !state.sessionPersistenceBlocked && isPresentationScopeId(scopeId);

    /** Commit metadata only, retaining dormant IDs and failing closed at the shared budget. */
    const writeScope = (state: AppStore, scopeId: string, items: Record<string, ContentPresentationItem>, order?: string[]): boolean => {
        const keep = Object.keys(items).length > 0 || Boolean(order?.length);
        if (keep && ((!scopeFor(state, scopeId) && Object.keys(state.contentPresentation).length >= MAX_PRESENTATION_SCOPES)
            || new Set([...Object.keys(items), ...(order ?? [])]).size > MAX_PRESENTATION_ITEMS_PER_SCOPE)) return false;
        const scope: ContentPresentationScope = { version: CONTENT_PRESENTATION_VERSION, items, ...(order?.length && { order }) };
        const contentPresentation: ContentPresentationMap = keep
            ? { ...state.contentPresentation, [scopeId]: scope }
            : { ...state.contentPresentation };
        if (!keep) delete contentPresentation[scopeId];
        set({ contentPresentation });
        void get().saveSession();
        return true;
    };

    const canChange = (state: AppStore, scopeId: string, contentKey: string) =>
        canWrite(state, scopeId)
        && isContentPresentationKey(contentKey) && hasLiveContent(state, scopeId, contentKey);

    const setContentFlag = (scopeId: string, contentKey: string, flag: 'pinned' | 'hidden', enabled: boolean): boolean => {
        const state = get();
        if (typeof enabled !== 'boolean' || !canChange(state, scopeId, contentKey)) return false;
        const scope = scopeFor(state, scopeId);
        if ((scope?.items[contentKey]?.[flag] === true) === enabled) return true;
        const items = { ...scope?.items };
        const item = { ...items[contentKey] };
        if (enabled) item[flag] = true;
        else delete item[flag];
        if (Object.keys(item).length) items[contentKey] = item;
        else delete items[contentKey];
        return writeScope(state, scopeId, items, scope?.order);
    };

    return {
        contentPresentation: {},
        workspaceViewRegistry: buildWorkspaceViewRegistry(BUILTIN_WORKSPACE_VIEW_REGISTRATIONS),
        setWorkspaceViewRegistry: workspaceViewRegistry => set({ workspaceViewRegistry }),

        setContentDisplayAlias: (scopeId, contentKey, alias) => {
            const state = get();
            if (!canChange(state, scopeId, contentKey)
                || (alias !== undefined && typeof alias !== 'string')) return false;
            const parsed = parseDisplayAliasDraft(alias ?? '');
            if (!parsed.ok) return false;
            const scope = scopeFor(state, scopeId);
            const current = scope?.items[contentKey]?.displayAlias;
            if (current === parsed.alias) return true;
            const items = { ...scope?.items };
            const item = { ...items[contentKey] };
            if (parsed.alias) item.displayAlias = parsed.alias;
            else delete item.displayAlias;
            if (Object.keys(item).length) items[contentKey] = item;
            else delete items[contentKey];
            return writeScope(state, scopeId, items, scope?.order);
        },

        setContentPinned: (scopeId, contentKey, pinned) => setContentFlag(scopeId, contentKey, 'pinned', pinned),
        setContentHidden: (scopeId, contentKey, hidden) => setContentFlag(scopeId, contentKey, 'hidden', hidden),

        revealAllContent: scopeId => {
            const state = get();
            if (!canWrite(state, scopeId)) return false;
            const scope = scopeFor(state, scopeId);
            if (!scope) return true;
            const items = { ...scope.items };
            let changed = false;
            for (const [key, previous] of Object.entries(items)) {
                if (!previous.hidden) continue;
                const item = { ...previous };
                delete item.hidden;
                if (Object.keys(item).length) items[key] = item;
                else delete items[key];
                changed = true;
            }
            return !changed || writeScope(state, scopeId, items, scope.order);
        },

        moveContent: (scopeId, contentKey, direction) => {
            const state = get();
            if ((direction !== -1 && direction !== 1) || !canChange(state, scopeId, contentKey)) return false;
            const scope = scopeFor(state, scopeId);
            const inventory = deriveWorkspaceContentInventory(state.terminals[scopeId] ?? [], state.paneLayouts[scopeId]);
            const ordered = sortContentPresentation(inventory, scope);
            const from = ordered.findIndex(item => item.id === contentKey);
            const target = ordered[from + direction];
            if (from < 0 || !target || (scope?.items[contentKey]?.pinned === true) !== (scope?.items[target.id]?.pinned === true)) return false;
            [ordered[from], ordered[from + direction]] = [target, ordered[from]];
            const liveIds = new Set(inventory.map(item => item.id));
            const prior = scope?.order ?? [];
            const knownIds = new Set(prior);
            const slots = [...prior, ...inventory.filter(item => !knownIds.has(item.id)).map(item => item.id)];
            let liveIndex = 0;
            // Replace live slots only: temporarily absent instances keep their saved rank.
            const order = slots.map(id => liveIds.has(id) ? ordered[liveIndex++].id : id);
            return writeScope(state, scopeId, { ...scope?.items }, order);
        },

        reorderContent: (scopeId, source, target, after) => {
            const state = get();
            if (!canWrite(state, scopeId) || typeof after !== 'boolean' || !source.length || !target.length
                || new Set([...source, ...target]).size !== source.length + target.length
                || [...source, ...target].some(id => !canChange(state, scopeId, id))) return false;
            // Reject stale drags after a split's membership changes. Reorder chrome,
            // never detach a member, reconnect a terminal or move its resource host.
            for (const layout of Object.values(state.paneLayouts[scopeId] ?? {})) {
                const keys = collectLeaves(layout.root).map(leaf => paneContentKey(leaf.content, leaf.id));
                for (const ids of [source, target]) {
                    if (keys.some(id => ids.includes(id)) && (keys.length !== ids.length || keys.some(id => !ids.includes(id)))) return false;
                }
            }
            const scope = scopeFor(state, scopeId);
            const inventory = deriveWorkspaceContentInventory(state.terminals[scopeId] ?? [], state.paneLayouts[scopeId]);
            const ordered = sortContentPresentation(inventory, scope).map(item => item.id);
            const visible = (ids: readonly string[]) => ids.filter(id => !scope?.items[id]?.hidden);
            const isPinned = (ids: readonly string[]) => visible(ids).some(id => scope?.items[id]?.pinned);
            if (!visible(source).length || !visible(target).length || isPinned(source) !== isPinned(target)) return false;
            const moving = ordered.filter(id => source.includes(id));
            const remaining = ordered.filter(id => !source.includes(id));
            const anchors = remaining.map((id, index) => visible(target).includes(id)
                && (scope?.items[id]?.pinned === true) === isPinned(target) ? index : -1).filter(index => index >= 0);
            const insertion = after ? Math.max(...anchors) + 1 : Math.min(...anchors);
            remaining.splice(insertion, 0, ...moving);
            if (remaining.every((id, index) => id === ordered[index])) return true;
            const live = new Set(ordered);
            const prior = scope?.order ?? [];
            const slots = [...prior, ...ordered.filter(id => !prior.includes(id))];
            let index = 0;
            return writeScope(state, scopeId, { ...scope?.items }, slots.map(id => live.has(id) ? remaining[index++] : id));
        },

        resetContentOrder: scopeId => {
            const state = get();
            const scope = scopeFor(state, scopeId);
            if (!canWrite(state, scopeId) || !scope?.order?.length) return;
            writeScope(state, scopeId, scope.items);
        },

        forgetContentPresentation: (scopeId, contentKeys) => {
            const state = get();
            if (!canWrite(state, scopeId) || !hasOwn(state.contentPresentation, scopeId)) return;
            const scope = state.contentPresentation[scopeId];
            const items = { ...scope.items };
            let changed = false;
            for (const key of contentKeys) {
                if (!hasOwn(items, key)) continue;
                delete items[key];
                changed = true;
            }
            const closed = new Set(contentKeys);
            const order = scope.order?.filter(key => !closed.has(key));
            if (!changed && order?.length === scope.order?.length) return;
            writeScope(state, scopeId, items, order);
        },

        resetContentPresentation: scopeId => {
            const state = get();
            if (!canWrite(state, scopeId) || !hasOwn(state.contentPresentation, scopeId)) return;
            const contentPresentation = { ...state.contentPresentation };
            delete contentPresentation[scopeId];
            set({ contentPresentation });
            void get().saveSession();
        },
    };
};
