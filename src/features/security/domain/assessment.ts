import type { ModuleDefinition } from './modules';
export type AssessmentKind = 'hardening';
export type FindingStatus = 'attention' | 'informational' | 'passed' | 'notAssessed' | 'notApplicable';
export interface AssessmentRequest { kind: AssessmentKind; elevationConsent?: boolean; modules?: readonly string[]; presetId?: string }
/** Inert, optional guidance recorded with the finding; older reports have only a next step. */
export interface RemediationGuide {
    change: string;
    impact: string;
    verification: string;
    rollback: string;
}
export interface Finding {
    id: string; status: FindingStatus; title: string; target: string;
    evidence: string; recommendation: string; reference: string;
    remediation?: RemediationGuide;
    category?: string; moduleId?: string;
    observed?: string; expected?: string; rationale?: string; scope?: string; scopeSummary?: string;
    ruleVersion?: string; reviewedAt?: string; applicabilityReason?: string;
    needsElevatedAccess?: boolean;
    sudoRetryEligible?: boolean;
    targetKey?: string; evidenceKey?: string;
    evidenceKind?: 'runtime' | 'effectiveConfiguration' | 'namedConfiguration' | 'metadata' | 'serviceConfiguration' | 'workloadConfiguration';
    priority?: 'high' | 'medium' | 'review';
}
export interface AssessmentProfile {
    id: string; label: string; platformId: string; platformVersion: string;
    coverage: 'targeted' | 'generic'; coverageNote: string;
}
export interface AssessmentReport {
    kind: AssessmentKind; target: string; os: string; version: string;
    findings: Finding[]; totalFindings: number; truncated: boolean;
    notes: string[]; collectorUid?: number | null; elevationRequested?: boolean;
    profile?: AssessmentProfile; modules?: ModuleDefinition[];
    transportFingerprint?: string;
    policy?: { id: string; label: string; revision: string };
}
export interface AssessmentSubject { connectionId: string; name: string; host: string; username: string; port: number }
export interface AssessmentAdmission { id: string; identity: Pick<AssessmentSubject, 'host' | 'username' | 'port'> }
export interface AssessmentResult { report: AssessmentReport; subject: AssessmentSubject; startedAt: number; completedAt: number }
export type AssessmentState =
    | { status: 'idle' | 'cancelled' }
    | { status: 'running' | 'stopping'; kind: AssessmentKind; startedAt: number; authenticationRequired?: boolean }
    | { status: 'failed'; message: string }
    | { status: 'completed'; result: AssessmentResult };

export const STATUS_LABELS: Record<FindingStatus, string> = { attention: 'Needs attention', informational: 'Informational', passed: 'Passed', notAssessed: 'Evidence unavailable', notApplicable: 'Not applicable' };

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
        if (finding.status === 'notApplicable') counts.notApplicable++;
        else if (finding.status === 'notAssessed') {
            if (finding.needsElevatedAccess) counts.elevated++;
            else counts.unavailable++;
        } else {
            counts.evaluated++;
            if (finding.status === 'passed') counts.passed++;
            else if (finding.status === 'attention') counts.attention++;
            else counts.informational++;
        }
        return counts;
    }, { evaluated: 0, elevated: 0, unavailable: 0, notApplicable: 0, passed: 0, attention: 0, informational: 0 });
}

/** Describe recorded run access without treating authorization as successful privilege elevation. */
export function hardeningAccessLabel(report: Pick<AssessmentReport, 'collectorUid' | 'elevationRequested'>): string {
    if (report.elevationRequested) return 'Sudo allowed';
    if (report.collectorUid === 0) return 'Root session';
    if (Number.isInteger(report.collectorUid) && (report.collectorUid ?? 0) > 0 && report.elevationRequested === false) return 'Standard access';
    return 'Access not recorded';
}

/** Native observations carry check-specific meaning; old inert fixtures receive only a state-based fallback. */
export function findingSummary(finding: Finding): string {
    if (finding.observed) return finding.observed;
    if (finding.status === 'notApplicable') return finding.applicabilityReason || 'This check does not apply to this host.';
    if (finding.status === 'notAssessed') {
        if (finding.needsElevatedAccess) return 'Your SSH account was denied access to information for this check.';
        return 'Zync could not collect enough information for this check.';
    }
    if (finding.status === 'passed') return 'This check meets the expected condition.';
    return finding.status === 'attention'
        ? 'Review this result against your host’s requirements.'
        : 'Information to review. This check has no automatic pass or fail result.';
}

/** Reference navigation accepts only reviewed hardening documentation locations. */
export function referenceUrl(value: string): string | null {
    const fixed = ['https://docs.kernel.org/admin-guide/sysctl/', 'https://man.openbsd.org/sshd_config', 'https://man7.org/linux/man-pages/man7/inode.7.html',
        'https://man7.org/linux/man-pages/man5/passwd.5.html', 'https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html',
        'https://man7.org/linux/man-pages/man8/ss.8.html', 'https://netfilter.org/projects/nftables/manpage.html', 'https://man7.org/linux/man-pages/man8/findmnt.8.html',
        'https://manpages.debian.org/bookworm/apt/apt-config.8.en.html', 'https://manpages.debian.org/bookworm/dpkg/dpkg.1.en.html',
        'https://ubuntu.com/server/docs/how-to/software/automatic-updates/',
        'https://nginx.org/en/docs/http/ngx_http_core_module.html', 'https://nginx.org/en/docs/http/ngx_http_autoindex_module.html',
        'https://nginx.org/en/docs/http/configuring_https_servers.html',
        'https://redis.io/docs/latest/operate/oss_and_stack/management/security/', 'https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/',
        'https://docs.docker.com/engine/security/', 'https://docs.docker.com/engine/security/seccomp/', 'https://docs.docker.com/engine/security/rootless/',
        'https://docs.docker.com/engine/logging/configure/', 'https://docs.docker.com/engine/daemon/live-restore/',
        'https://docs.kernel.org/admin-guide/sysctl/fs.html', 'https://docs.kernel.org/admin-guide/perf-security.html',
        'https://docs.kernel.org/admin-guide/sysctl/kernel.html', 'https://docs.kernel.org/admin-guide/sysrq.html',
        'https://docs.kernel.org/networking/ip-sysctl.html', 'https://man7.org/linux/man-pages/man5/group.5.html',
        'https://man7.org/linux/man-pages/man5/gshadow.5.html', 'https://www.sudo.ws/docs/man/sudoers.man/',
        'https://man7.org/linux/man-pages/man5/crontab.5.html', 'https://docs.kernel.org/security/lsm.html',
        'https://man7.org/linux/man-pages/man8/getenforce.8.html', 'https://ubuntu.com/server/docs/how-to/security/apparmor/',
        'https://man7.org/linux/man-pages/man8/auditctl.8.html', 'https://www.freedesktop.org/software/systemd/man/latest/timedatectl.html',
        'https://dev.mysql.com/doc/refman/8.4/en/grant-tables.html', 'https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html',
        'https://redis.io/docs/latest/commands/acl-dryrun/', 'https://redis.io/docs/latest/commands/config-get/',
        'https://www.jenkins.io/doc/book/security/', 'https://www.jenkins.io/doc/book/security/access-control/',
        'https://www.jenkins.io/doc/book/security/controller-isolation/', 'https://www.jenkins.io/doc/book/security/csrf-protection/',
        'https://www.postgresql.org/docs/current/view-pg-hba-file-rules.html', 'https://www.postgresql.org/docs/current/view-pg-roles.html',
        'https://www.postgresql.org/docs/current/view-pg-settings.html', 'https://docs.docker.com/engine/containers/run/',
        'https://docs.docker.com/reference/cli/docker/container/run/', 'https://docs.docker.com/engine/containers/resource_constraints/',
        'https://man.openbsd.org/sshd'];
    return fixed.includes(value) ? value : null;
}

/** Reject unsupported scopes before native admission, including stale callers of the removed VA mode. */
export function requestError(request: AssessmentRequest): string | undefined {
    if (request.kind !== 'hardening') return 'Only security hardening assessments are supported.';
    if (request.presetId !== undefined && !/^[a-z][a-z0-9-]{0,47}$/.test(request.presetId)) return 'Choose a valid assessment preset.';
    if (request.modules !== undefined && (!Array.isArray(request.modules) || request.modules.length === 0 || request.modules.length > 64
        || new Set(request.modules).size !== request.modules.length
        || request.modules.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(id)))) return 'Choose at least one valid check area.';
    return undefined;
}

/** Keep sorting/filtering independent of rendering; no mutation of retained report data. */
export function filterFindings(findings: readonly Finding[], query: string, status = 'all', category = 'all', moduleId = 'all'): Finding[] {
    const search = query.trim().toLocaleLowerCase();
    return findings.filter(item => (status === 'needsElevatedAccess' ? item.status === 'notAssessed' && item.needsElevatedAccess
            : status === 'evidenceUnavailable' ? item.status === 'notAssessed' && !item.needsElevatedAccess : status === 'all' || item.status === status)
        && (category === 'all' || item.category === category)
        && (moduleId === 'all' || item.moduleId === moduleId)
        && (!search || `${item.id} ${item.title} ${item.target} ${item.category ?? ''} ${item.observed ?? ''} ${item.expected ?? ''} ${item.rationale ?? ''} ${item.scope ?? ''} ${item.scopeSummary ?? ''} ${item.applicabilityReason ?? ''} ${item.recommendation}`.toLocaleLowerCase().includes(search)))
        .sort((left, right) => {
            const rank = { attention: 0, notAssessed: 1, informational: 2, passed: 3, notApplicable: 4 };
            const priority = { high: 0, medium: 1, review: 2 };
            return rank[left.status] - rank[right.status]
                || (left.status === 'attention' ? priority[left.priority ?? 'review'] - priority[right.priority ?? 'review'] : 0);
        });
}
