import type { ReactNode } from 'react';

export interface PaneGroupTabMember {
    id: string;
    label: string;
    icon: ReactNode;
}

/** Share compact labels with drag previews; full member names stay in the tooltip. */
export function describePaneGroup(members: readonly PaneGroupTabMember[], hiddenCount = 0) {
    const count = members.length;
    const memberLabel = count === 0 ? 'Pane group' : count <= 2
        ? members.map(member => member.label).join(' · ')
        : members[0].label;
    const label = count > 2 ? `${memberLabel} · ${count} panes` : memberLabel;
    const description = `Pane group, ${count} visible ${count === 1 ? 'pane' : 'panes'}`
        + (count > 0 ? `: ${members.map(member => member.label).join(', ')}` : '')
        + (hiddenCount > 0 ? ` (${hiddenCount} hidden)` : '');
    const total = count + hiddenCount;
    const closeDescription = `Close pane group (${total} ${total === 1 ? 'pane' : 'panes'}${hiddenCount > 0 ? `, including ${hiddenCount} hidden` : ''}): ${memberLabel}`;
    return { label, description, count, closeDescription };
}

/** A shared frame groups up to two readable resource icons without overlapping them. */
export function PaneGroupTabIcon({ members }: { members: readonly PaneGroupTabMember[] }) {
    return <span aria-hidden="true" data-pane-group-icon
        className="inline-flex h-5 shrink-0 items-center rounded bg-app-text/5 px-px ring-1 ring-inset ring-app-text/15">
        {members.slice(0, 2).map((member, index) => <span key={member.id}
            data-pane-group-member={member.id}
            className={index === 0
                ? 'inline-flex h-4 w-4 shrink-0 items-center justify-center'
                : 'inline-flex h-4 w-4 shrink-0 items-center justify-center border-l border-app-text/10'}>
            {member.icon}
        </span>)}
    </span>;
}
