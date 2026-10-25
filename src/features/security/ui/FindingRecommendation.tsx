import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Finding, RemediationGuide } from '../domain/assessment';

const GUIDE_FIELDS: readonly { key: keyof RemediationGuide; label: string; steps?: boolean }[] = [
    { key: 'change', label: 'What to change', steps: true },
    { key: 'impact', label: 'What could be affected' },
    { key: 'verification', label: 'How to verify', steps: true },
    { key: 'rollback', label: 'How to undo' },
];
const MAX_GUIDE_STEPS = 12;

/** Render authored line boundaries only; newline-heavy imports retain text without excessive list nodes. */
function GuideText({ value, steps }: { value: string; steps?: boolean }) {
    const lines = steps ? value.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean) : [];
    return lines.length > 1 && lines.length <= MAX_GUIDE_STEPS
        ? <ol className="list-decimal space-y-2 pl-5 marker:text-app-muted">{lines.map((line, index) => <li key={index} className="pl-1">{line}</li>)}</ol>
        : <p className="whitespace-pre-line">{value}</p>;
}

/** A configuration-change guide only belongs to an assessed finding needing attention. */
export function remediationGuide(finding: Finding): RemediationGuide | undefined {
    const guide = finding.status === 'attention' && finding.recommendation.trim() ? finding.remediation : undefined;
    return guide && GUIDE_FIELDS.every(({ key }) => typeof guide[key] === 'string' && Boolean(guide[key].trim())) ? guide : undefined;
}

/** Native guidance stays inert text; the optional detail never executes a suggested change. */
export function FindingRecommendation({ finding, guide, sourceLink }: { finding: Finding; guide?: RemediationGuide; sourceLink?: ReactNode }) {
    if (finding.status !== 'attention' && finding.status !== 'notAssessed') return null;
    const nextStep = finding.recommendation.trim();
    if (!nextStep) return null;
    return <div className="rounded-lg border border-app-border bg-app-panel p-4">
        <p className="font-medium">{finding.status === 'attention' ? 'Recommended next step' : 'Next step'}</p>
        <p className="mt-2 whitespace-pre-line break-words leading-6">{nextStep}</p>
        {finding.status === 'attention' && guide && <details className="group/remediation mt-4 border-t border-app-border pt-3" data-finding-remediation>
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded py-1 text-app-muted hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus [&::-webkit-details-marker]:hidden">
                <ChevronRight size={13} aria-hidden="true" className="shrink-0 transition-transform group-open/remediation:rotate-90 motion-reduce:transition-none" />How to address it
            </summary>
            <dl className="mt-4 space-y-5">
                {GUIDE_FIELDS.map(({ key, label, steps }) => <div key={key}>
                    <dt className="font-medium">{label}</dt>
                    <dd className="mt-2 break-words leading-6 text-app-muted"><GuideText value={guide[key]} steps={steps} /></dd>
                </div>)}
            </dl>
            {sourceLink}
        </details>}
    </div>;
}
