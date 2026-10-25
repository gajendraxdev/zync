import type { AssessmentResult, Finding } from './assessment';

export type DifferenceState = 'new' | 'unchanged' | 'resolved' | 'changed' | 'nowAssessed' | 'noLongerAssessed' | 'notCompared';
export interface FindingDifference { state: DifferenceState; finding: Finding; previous?: Finding; current: boolean }
export interface RiskException {
    id: string; host: string; username: string; port: number; transportFingerprint: string;
    policyId: string; policyRevision: string; moduleId: string; targetKey: string;
    ruleId: string; ruleVersion: string; evidenceKey: string; reason: string; createdAt: number; expiresAt: number;
}
export const MAX_RISK_EXCEPTIONS = 1000;
export const MAX_EXCEPTION_DAYS = 90;

/** Presentation and persistence share the exact acceptance binding; reasons and renewal dates are not identity. */
export function riskIdentityKey(item: Pick<RiskException, 'host' | 'username' | 'port' | 'transportFingerprint' | 'policyId' | 'policyRevision' | 'moduleId' | 'targetKey' | 'ruleId' | 'ruleVersion' | 'evidenceKey'>): string {
    return JSON.stringify([item.host, item.username, item.port, item.transportFingerprint, item.policyId, item.policyRevision, item.moduleId, item.targetKey, item.ruleId, item.ruleVersion, item.evidenceKey]);
}

/** A missing legacy identity cannot acquire an acceptance from another target or host. */
export function findingRiskIdentityKey(result: AssessmentResult, finding: Finding): string | undefined {
    const policy = result.report.policy;
    if (finding.status !== 'attention' || !result.report.transportFingerprint || !policy || !finding.moduleId || !finding.targetKey || !finding.ruleVersion || !finding.evidenceKey) return undefined;
    return riskIdentityKey({ ...result.subject, transportFingerprint: result.report.transportFingerprint, policyId: policy.id, policyRevision: policy.revision,
        moduleId: finding.moduleId, targetKey: finding.targetKey, ruleId: finding.id, ruleVersion: finding.ruleVersion, evidenceKey: finding.evidenceKey });
}

/** A comparison needs the verified transport, account and authored policy, rather than just a saved hostname. */
export function comparisonIssue(current: AssessmentResult, previous: AssessmentResult): string | undefined {
    if (previous.startedAt > current.startedAt || previous.completedAt > current.completedAt) return 'Choose an earlier report to compare with this assessment.';
    if (!current.report.transportFingerprint || !previous.report.transportFingerprint || !current.report.policy || !previous.report.policy) return 'This report lacks the verified host or policy identity needed for comparison.';
    if (current.subject.host !== previous.subject.host || current.subject.username !== previous.subject.username || current.subject.port !== previous.subject.port
        || current.report.transportFingerprint !== previous.report.transportFingerprint) return 'Choose a report from the same verified host and SSH account.';
    if (current.report.policy.id !== previous.report.policy.id || current.report.policy.revision !== previous.report.policy.revision) return 'These reports use different policy presets or revisions.';
    return undefined;
}

/** Target and rule revisions are part of identity; a renamed or recreated workload is not an automatic fix. */
function findingKey(finding: Finding, revision = true): string | undefined {
    if (!finding.moduleId || !finding.targetKey || !finding.ruleVersion) return undefined;
    return JSON.stringify([finding.moduleId, finding.id, finding.targetKey, ...(revision ? [finding.ruleVersion] : [])]);
}

/** Compare immutable normalized reports without inferring a resolution from missing, unselected or unavailable evidence. */
export function compareAssessments(current: AssessmentResult, previous: AssessmentResult): FindingDifference[] {
    const compatible = !comparisonIssue(current, previous);
    const exact = new Map<string, Finding>();
    const existing = new Set<string>();
    const duplicate = new Set<string>();
    for (const finding of previous.report.findings) {
        const key = findingKey(finding);
        const basic = findingKey(finding, false);
        if (key) { if (exact.has(key)) duplicate.add(key); exact.set(key, finding); }
        if (basic) existing.add(basic);
    }
    const visited = new Set<Finding>();
    const rows: FindingDifference[] = current.report.findings.map(finding => {
        const key = findingKey(finding);
        const basic = findingKey(finding, false);
        const before = key ? exact.get(key) : undefined;
        if (before) visited.add(before);
        const sharedScope = current.report.modules?.some(module => module.id === finding.moduleId)
            && previous.report.modules?.some(module => module.id === finding.moduleId);
        if (!compatible || !key || !finding.evidenceKey || !sharedScope || duplicate.has(key)
            || finding.status === 'notApplicable'
            || (before && (!before.evidenceKey || before.status === 'notApplicable'))
            || (!before && basic && existing.has(basic))) return { state: 'notCompared', finding, previous: before, current: true };
        // An access/collection change is coverage, never proof that a security issue was fixed.
        if (before?.status === 'notAssessed' && finding.status !== 'notAssessed') return { state: 'nowAssessed', finding, previous: before, current: true };
        if (finding.status === 'notAssessed') return { state: before && before.status !== 'notAssessed' ? 'noLongerAssessed' : 'notCompared', finding, previous: before, current: true };
        if (!before) return { state: 'new', finding, current: true };
        if (before.status === 'attention' && finding.status === 'passed') return { state: 'resolved', finding, previous: before, current: true };
        return { state: before.status === finding.status && before.evidenceKey === finding.evidenceKey ? 'unchanged' : 'changed', finding, previous: before, current: true };
    });
    for (const finding of previous.report.findings) {
        if (!visited.has(finding)) rows.push({ state: 'notCompared', finding, previous: finding, current: false });
    }
    return rows;
}

/** Exceptions annotate only the exact evidenced attention finding, never the underlying status or coverage. */
export function matchingRiskException(result: AssessmentResult, finding: Finding, annotations: readonly RiskException[], now: number): RiskException | undefined {
    const identity = findingRiskIdentityKey(result, finding);
    if (!identity) return undefined;
    return annotations.find(item => item.expiresAt > now && item.createdAt <= now
        && riskIdentityKey(item) === identity);
}

/** Create a bounded, expiring annotation only after the user explains acceptance of a strongly identified result. */
export function createRiskException(result: AssessmentResult, finding: Finding, reason: string, expiresAt: number, now: number, id: string): RiskException | undefined {
    const policy = result.report.policy;
    const explanation = reason.replace(/[\n\r\t]/g, ' ').replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '').trim();
    if (finding.status !== 'attention' || !result.report.transportFingerprint || !policy || !finding.moduleId || !finding.targetKey || !finding.ruleVersion || !finding.evidenceKey
        || !explanation || reason.length > 500 || !Number.isFinite(expiresAt)
        || expiresAt <= now || expiresAt > now + MAX_EXCEPTION_DAYS * 86400000) return undefined;
    return { id, host: result.subject.host, username: result.subject.username, port: result.subject.port,
        transportFingerprint: result.report.transportFingerprint, policyId: policy.id, policyRevision: policy.revision,
        moduleId: finding.moduleId, targetKey: finding.targetKey, ruleId: finding.id, ruleVersion: finding.ruleVersion,
        evidenceKey: finding.evidenceKey, reason: explanation, createdAt: now, expiresAt };
}

/** Merge explicit imported annotations with a fixed retention cap; duplicate IDs replace instead of accumulating copies. */
export function mergeRiskExceptions(current: readonly RiskException[], incoming: readonly RiskException[]): RiskException[] {
    return [...new Map([...current, ...incoming].map(item => [item.id, item])).values()].slice(-MAX_RISK_EXCEPTIONS);
}
