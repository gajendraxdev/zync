import type { AssessmentResult } from './assessment';
import { findingRiskIdentityKey, riskIdentityKey, type RiskException } from './review';

export interface SavedRisk { id: string; revision: number; title: string; target: string; annotation: RiskException }

/** Historical notes and registry renewals match only when all acceptance content is still identical. */
export function sameRiskAcceptance(left: RiskException, right: RiskException): boolean {
    return riskIdentityKey(left) === riskIdentityKey(right) && left.id === right.id && left.reason === right.reason
        && left.createdAt === right.createdAt && left.expiresAt === right.expiresAt;
}

/** Index once per report; an expired renewal never revives an older acceptance for the same evidence. */
export function reportRiskAnnotations(result: AssessmentResult, annotations: readonly RiskException[]): RiskException[] {
    const indexed = new Map<string, RiskException>();
    for (const item of annotations) {
        const key = riskIdentityKey(item); const before = indexed.get(key);
        if (!before || item.createdAt >= before.createdAt) indexed.set(key, item);
    }
    return result.report.findings.flatMap(finding => {
        const key = findingRiskIdentityKey(result, finding); const item = key ? indexed.get(key) : undefined;
        return item ? [item] : [];
    });
}

/** Renewal references are explicit; an acceptance changed in another pane is never silently overwritten. */
export function acceptanceRevisions(rows: readonly SavedRisk[], annotations: readonly RiskException[]): Pick<SavedRisk, 'id' | 'revision'>[] {
    const keys = new Set(annotations.map(riskIdentityKey));
    return rows.filter(row => keys.has(riskIdentityKey(row.annotation))).map(({ id, revision }) => ({ id, revision }));
}

/** A report's delete checkbox affects only still-identical notes; independently renewed acceptances are kept. */
export function reportRiskRemovals(rows: readonly SavedRisk[], annotations: readonly RiskException[]): SavedRisk[] {
    return rows.filter(row => annotations.some(item => sameRiskAcceptance(row.annotation, item)));
}
