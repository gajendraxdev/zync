import { useEffect, useState } from 'react';
import type { ModuleDefinition, ScopePreset } from '../domain/modules';
import { loadAssessmentCatalog } from '../infrastructure/assessmentIpc';

interface ScopeState {
    owner: object;
    status: 'loading' | 'ready' | 'failed';
    modules: ModuleDefinition[];
    selected: string[];
    presets: ScopePreset[];
    presetId: string;
}

/** Keep local catalog choices pane/connection-owned, with no discovery, persistence or assessment effects. */
export function useAssessmentModules(owner: object) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<ScopeState>({ owner, status: 'loading', modules: [], selected: [], presets: [], presetId: '' });
    useEffect(() => {
        let active = true;
        setState({ owner, status: 'loading', modules: [], selected: [], presets: [], presetId: '' });
        void loadAssessmentCatalog().then(catalog => {
            const preset = catalog.presets.find(item => item.id === catalog.defaultPresetId)!;
            if (active) setState({ owner, status: 'ready', modules: catalog.modules, selected: [...preset.moduleIds], presets: catalog.presets, presetId: preset.id });
        }).catch(() => { if (active) setState({ owner, status: 'failed', modules: [], selected: [], presets: [], presetId: '' }); });
        return () => { active = false; };
    }, [owner, attempt]);
    const current = state.owner === owner ? state : { owner, status: 'loading' as const, modules: [], selected: [], presets: [], presetId: '' };
    return { ...current,
        /** Reload only the local catalog; an assessment still requires a separate explicit approval. */
        retry: () => setAttempt(value => value + 1),
        /** Ignore stale-owner changes and retain only IDs from this pane's loaded native catalog. */
        setSelected: (ids: readonly string[]) => setState(previous => previous.owner !== owner || previous.status !== 'ready' ? previous : {
            ...previous, selected: previous.modules.filter(module => ids.includes(module.id)).map(module => module.id),
        }),
        /** Preset choices change only draft scope and never start work or authorize credentials. */
        setPreset: (id: string) => setState(previous => {
            const preset = previous.presets.find(item => item.id === id);
            return previous.owner !== owner || previous.status !== 'ready' || !preset ? previous : { ...previous, presetId: id, selected: [...preset.moduleIds] };
        }),
    };
}
