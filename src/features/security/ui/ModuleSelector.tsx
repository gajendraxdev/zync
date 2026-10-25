import { useId, useState } from 'react';
import { ChevronRight, Layers3 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { cn } from '../../../lib/utils';
import { moduleScopeSummary, selectedModules, type ModuleDefinition } from '../domain/modules';

interface ModuleSelectorProps {
    modules: readonly ModuleDefinition[]; selected: readonly string[]; disabled: boolean;
    onChange(ids: readonly string[]): void;
}

/** Keep optional choices out of the task card while showing the selected scope before approval. */
export function ModuleSelector({ modules, selected, disabled, onChange }: ModuleSelectorProps) {
    const descriptionPrefix = useId();
    const [open, setOpen] = useState(false);
    const chosen = selectedModules(modules, selected);
    return <>
        <button type="button" data-assessment-module-picker disabled={disabled} onClick={() => setOpen(true)}
            className="flex w-full items-center gap-3 rounded-lg border border-app-border bg-app-bg/40 px-3 py-2.5 text-left hover:border-app-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus disabled:cursor-not-allowed disabled:opacity-60">
            <Layers3 size={15} className="shrink-0 text-app-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block text-[11px] text-app-muted">Areas</span>
                <span className="mt-0.5 block break-words text-xs font-medium">{moduleScopeSummary(chosen)}</span></span>
            <span className="text-xs text-app-muted">Edit</span><ChevronRight size={14} className="shrink-0 text-app-muted" aria-hidden="true" />
        </button>
        <Modal isOpen={open} onClose={() => setOpen(false)} title="Choose checks" subtitle="Select the areas for this assessment" width="max-w-xl">
            <div className="space-y-5">
                {(['host', 'applications'] as const).map(group => {
                    const options = modules.filter(module => module.group === group);
                    return options.length > 0 && <fieldset key={group} disabled={disabled} className="min-w-0 space-y-1 disabled:opacity-60">
                        <legend className="mb-2 text-xs font-medium text-app-muted">{group === 'host' ? 'Host checks' : 'Applications'}</legend>
                        {options.map(module => <label key={module.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors', disabled && 'cursor-not-allowed',
                            selected.includes(module.id) ? 'border-app-accent/40 bg-app-accent/5' : 'border-transparent hover:bg-app-surface/40')}>
                            <input type="checkbox" aria-label={module.label} aria-describedby={descriptionPrefix + '-' + module.id} checked={selected.includes(module.id)}
                                onChange={event => onChange(event.target.checked ? [...selected, module.id] : selected.filter(id => id !== module.id))}
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-app-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus" />
                            <span className="min-w-0 flex-1"><span className="block break-words text-xs font-medium">{module.label}</span>
                                <span id={descriptionPrefix + '-' + module.id} className="mt-1 block break-words text-[11px] leading-relaxed text-app-muted">{module.description}
                                    {module.targetLimit && <span className="block">Up to {module.targetLimit} {module.targetLabel || 'targets'}.</span>}
                                    <span className="sr-only"> {module.checkCount} checks.</span>
                                </span></span>
                            <span className="shrink-0 text-[11px] tabular-nums text-app-muted" aria-hidden="true">{module.checkCount}</span>
                        </label>)}
                    </fieldset>;
                })}
                <div className="flex items-center justify-between gap-3 border-t border-app-border pt-3">
                    <p className="text-xs text-app-muted">{moduleScopeSummary(chosen)}</p><Button size="sm" onClick={() => setOpen(false)}>Done</Button>
                </div>
            </div>
        </Modal>
    </>;
}
