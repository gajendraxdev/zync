import type { AssessmentProfile } from './assessment';
import type { ScopePreset } from './modules';

/** Explain known baseline identifiers without changing recorded values or inventing unknown revisions. */
export function auditRulesLabel(value: string, includeDate = false): string {
    const baseline = /^zync-linux-(\d+)(?: \((\d{4}-\d{2}-\d{2})\))?$/.exec(value);
    return baseline ? `Linux audit rules · v${baseline[1]}${includeDate && baseline[2] ? ` (${baseline[2]})` : ''}` : value;
}

/** Use the authored profile label; generic coverage must never imply OS-specific checks. */
export function auditProfileLabel(profile: AssessmentProfile): string {
    const label = profile.label.trim() || profile.id;
    if (label === 'Zync Linux generic') return 'General Linux checks';
    return label.replace(/^Zync (?=Ubuntu(?:\s|$)|Debian(?:\s|$))/, '');
}

/** Reuse native preset names when available, retaining unknown historical identifiers honestly. */
export function auditPresetLabel(id: string, presets: readonly ScopePreset[]): string {
    return presets.find(preset => preset.id === id)?.label ?? id;
}

/** Known policy revisions have a readable label; custom imported revisions retain their recorded text. */
export function auditPolicyRevisionLabel(value: string): string {
    const revision = /^(?:zync-role-)?(\d+)$/.exec(value);
    return revision ? `Revision ${revision[1]}` : value;
}
