export type AssessmentKind = 'hardening';
export type FindingStatus = 'attention' | 'informational' | 'passed' | 'notAssessed';
export interface AssessmentRequest { kind: AssessmentKind; elevationConsent?: boolean }
export interface Finding {
    id: string; status: FindingStatus; title: string; target: string;
    evidence: string; recommendation: string; reference: string;
    category?: string;
    needsElevatedAccess?: boolean;
    sudoRetryEligible?: boolean;
}
export interface AssessmentReport {
    kind: AssessmentKind; target: string; os: string; version: string;
    findings: Finding[]; totalFindings: number; truncated: boolean;
    notes: string[]; collectorUid?: number | null; elevationRequested?: boolean;
}
export interface AssessmentSubject { connectionId: string; name: string; host: string; username: string; port: number }
export interface AssessmentAdmission { id: string; identity: Pick<AssessmentSubject, 'host' | 'username' | 'port'> }
export interface AssessmentResult { report: AssessmentReport; subject: AssessmentSubject; startedAt: number; completedAt: number }
export type AssessmentState =
    | { status: 'idle' | 'cancelled' }
    | { status: 'running' | 'stopping'; kind: AssessmentKind; startedAt: number; authenticationRequired?: boolean }
    | { status: 'failed'; message: string }
    | { status: 'completed'; result: AssessmentResult };

export const STATUS_LABELS: Record<FindingStatus, string> = { attention: 'Needs attention', informational: 'Informational', passed: 'Passed', notAssessed: 'Evidence unavailable' };

/** Access is a known evidence restriction, not a failed security check or a guess from a generic error. */
export function findingStatusLabel(finding: Pick<Finding, 'status' | 'needsElevatedAccess'>): string {
    return finding.status === 'notAssessed' && finding.needsElevatedAccess ? 'Needs elevated access' : STATUS_LABELS[finding.status];
}

export type SudoRetryLabel = 'Retry with sudo' | 'Try with sudo';

/** A retry suggestion never upgrades an uncertain collection failure into a confirmed access denial. */
export function findingSudoRetryLabel(finding: Pick<Finding, 'status' | 'needsElevatedAccess' | 'sudoRetryEligible'>): SudoRetryLabel | undefined {
    if (finding.status !== 'notAssessed') return undefined;
    if (finding.needsElevatedAccess) return 'Retry with sudo';
    return finding.sudoRetryEligible ? 'Try with sudo' : undefined;
}

/** Only a recorded, non-root, unelevated hardening run can offer the existing full-run approval flow. */
export function hardeningSudoRetryLabel(report: AssessmentReport): SudoRetryLabel | undefined {
    if (report.kind !== 'hardening' || report.elevationRequested !== false
        || !Number.isInteger(report.collectorUid) || (report.collectorUid ?? 0) <= 0) return undefined;
    if (report.findings.some(finding => findingSudoRetryLabel(finding) === 'Retry with sudo')) return 'Retry with sudo';
    return report.findings.some(finding => findingSudoRetryLabel(finding)) ? 'Try with sudo' : undefined;
}

/** Disjoint coverage counts describe retained checks, not a score or a claim that sudo succeeded. */
export function hardeningCoverage(findings: readonly Finding[]) {
    return findings.reduce((counts, finding) => {
        if (finding.status === 'notAssessed') {
            if (finding.needsElevatedAccess) counts.elevated++;
            else counts.unavailable++;
        } else {
            counts.evaluated++;
            if (finding.status === 'passed') counts.passed++;
            else if (finding.status === 'attention') counts.attention++;
            else counts.informational++;
        }
        return counts;
    }, { evaluated: 0, elevated: 0, unavailable: 0, passed: 0, attention: 0, informational: 0 });
}

/** Describe recorded run access without treating authorization as successful privilege elevation. */
export function hardeningAccessLabel(report: Pick<AssessmentReport, 'collectorUid' | 'elevationRequested'>): string {
    if (report.elevationRequested) return 'Sudo allowed';
    if (report.collectorUid === 0) return 'Root session';
    if (Number.isInteger(report.collectorUid) && (report.collectorUid ?? 0) > 0 && report.elevationRequested === false) return 'Standard access';
    return 'Access not recorded';
}

/** Short explanations depend on structured result state, never guessed causes or truncated security advice. */
export function findingSummary(finding: Finding): string {
    if (finding.status === 'notAssessed') {
        if (finding.needsElevatedAccess) return 'Access to protected evidence was denied.';
        return finding.id.startsWith('SSH-') ? 'Couldn’t read SSH settings.' : 'Couldn’t collect usable evidence for this check.';
    }
    if (finding.status === 'passed') return 'This check met its baseline condition.';
    if (finding.id.startsWith('SSH-')) return finding.status === 'attention'
        ? 'This SSH default needs attention. Connection-specific policy was not verified.'
        : 'SSH default recorded. Connection-specific policy was not verified.';
    return finding.status === 'attention'
        ? 'A baseline deviation or maintenance signal needs attention. Check the evidence against your host’s requirements.'
        : 'Contextual observation; no automatic pass or fail decision.';
}

/** Reference navigation accepts only reviewed hardening documentation locations. */
export function referenceUrl(value: string): string | null {
    const fixed = ['https://docs.kernel.org/admin-guide/sysctl/', 'https://man.openbsd.org/sshd_config', 'https://man7.org/linux/man-pages/man7/inode.7.html',
        'https://man7.org/linux/man-pages/man5/passwd.5.html', 'https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html',
        'https://man7.org/linux/man-pages/man8/ss.8.html', 'https://netfilter.org/projects/nftables/manpage.html', 'https://man7.org/linux/man-pages/man8/findmnt.8.html',
        'https://manpages.debian.org/bookworm/apt/apt-config.8.en.html', 'https://manpages.debian.org/bookworm/dpkg/dpkg.1.en.html'];
    return fixed.includes(value) ? value : null;
}

/** Reject unsupported scopes before native admission, including stale callers of the removed VA mode. */
export function requestError(request: AssessmentRequest): string | undefined {
    return request.kind === 'hardening' ? undefined : 'Only security hardening assessments are supported.';
}

/** Keep sorting/filtering independent of rendering; no mutation of retained report data. */
export function filterFindings(findings: readonly Finding[], query: string, status = 'all', category = 'all'): Finding[] {
    const search = query.trim().toLocaleLowerCase();
    return findings.filter(item => (status === 'needsElevatedAccess' ? item.status === 'notAssessed' && item.needsElevatedAccess
            : status === 'evidenceUnavailable' ? item.status === 'notAssessed' && !item.needsElevatedAccess : status === 'all' || item.status === status)
        && (category === 'all' || item.category === category)
        && (!search || `${item.id} ${item.title} ${item.target} ${item.category ?? ''} ${item.recommendation}`.toLocaleLowerCase().includes(search)))
        .sort((left, right) => {
            const rank = { attention: 0, notAssessed: 1, informational: 2, passed: 3 };
            return rank[left.status] - rank[right.status];
        });
}
