import { AssessmentController, type AssessmentPort } from '../src/features/security/application/assessmentController';
import { filterFindings, findingStatusLabel, findingSummary, findingSudoRetryLabel, hardeningAccessLabel, hardeningCoverage, hardeningSudoRetryLabel, referenceUrl, requestError, STATUS_LABELS, type AssessmentRequest, type AssessmentAdmission, type AssessmentReport, type AssessmentSubject, type Finding } from '../src/features/security/domain/assessment';
import { buildWorkspaceOpenItems } from '../src/components/layout/workspaceOpen/buildWorkspaceOpenItems';
import { SPLIT_FEATURE_IDS } from '../src/lib/paneLayout/types';
import { builtinWorkspaceViewLabel } from '../src/features/workspace/domain/registrations';

/** Fail without coupling the browser-oriented project to Node type declarations. */
function check(value: unknown, message: string): void { if (!value) throw new Error(message); }
/** Control admission and execution races without a real SSH transport or network request. */
function deferred<T>() { let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

const subject: AssessmentSubject = { connectionId: 'fixture', name: 'Fixture', host: 'fixture.invalid', username: 'fixture', port: 22 };
const report: AssessmentReport = { kind: 'hardening', target: 'Connected Linux host', os: 'ubuntu 24.04', version: 'fixture', findings: [], totalFindings: 0, truncated: false,
    notes: ['fixture coverage'] };
const request = { kind: 'hardening' as const };
check(STATUS_LABELS.notAssessed === 'Evidence unavailable', 'Missing check evidence is not presented as a failed check');
check(findingStatusLabel({ status: 'notAssessed', needsElevatedAccess: true }) === 'Needs elevated access', 'Verified restricted evidence has an explicit access badge');
check(findingStatusLabel({ status: 'notAssessed' }) === 'Evidence unavailable', 'Old reports and unknown causes do not claim sudo is required');
check(findingStatusLabel({ status: 'passed', needsElevatedAccess: true }) === 'Passed', 'An inconsistent access flag cannot override a completed check');
check(!requestError({ kind: 'hardening', elevationConsent: true }), 'Explicit hardening elevation is allowed');
const identity = { host: subject.host, username: subject.username, port: subject.port };
const begins = deferred<AssessmentAdmission>();
let beginCalls = 0;
let runCalls = 0;
const cancelled: string[] = [];
const port: AssessmentPort = { begin: async () => { beginCalls++; return begins.promise; },
    run: async () => { runCalls++; return report; }, cancel: async id => { cancelled.push(id); } };
const controller = new AssessmentController(subject, port);
check(beginCalls === 0 && controller.snapshot().status === 'idle', 'Opening/restoring a pane never starts work');
const starting = controller.start(request);
await controller.start(request);
check(beginCalls === 1, 'One pending run per pane');
controller.cancel();
begins.resolve({ id: 'pending-id', identity });
await starting;
check(runCalls === 0 && cancelled.includes('pending-id'), 'Early cancellation cannot launch collectors');
check(controller.snapshot().status === 'cancelled', 'Admission cancellation stays cancelled');

const running = deferred<AssessmentReport>();
const active = new AssessmentController(subject, { ...port, begin: async () => ({ id: 'active', identity }), run: async () => running.promise });
const operation = active.start(request);
await Promise.resolve();
active.cancel();
running.resolve(report);
await operation;
check(active.snapshot().status === 'cancelled', 'Late results cannot overwrite cancellation');

const mutableSubject = { ...subject };
const captured = new AssessmentController(mutableSubject, { ...port, begin: async () => ({ id: 'captured', identity }), run: async () => report });
const completed = captured.start(request);
mutableSubject.host = 'changed.invalid';
await completed;
const result = captured.snapshot();
check(result.status === 'completed', 'Explicit completion publishes report');
if (result.status !== 'completed') throw new Error('Missing completed fixture');
check(result.result.subject.host === 'fixture.invalid', 'Report captures the live host identity');
check(result.result.startedAt <= result.result.completedAt, 'Export timestamps are ordered');

const mismatch = new AssessmentController(subject, { ...port, begin: async () => ({ id: 'wrong', identity }), run: async () => ({ ...report, kind: 'unsupported' } as unknown as AssessmentReport) });
await mismatch.start(request);
check(mismatch.snapshot().status === 'failed', 'Mismatched response type is rejected');
let wrongHostRuns = 0;
const edited = new AssessmentController({ ...subject, host: 'edited.invalid' }, { ...port, begin: async () => ({ id: 'old-live-transport', identity }), run: async () => { wrongHostRuns++; return report; } });
await edited.start(request);
check(edited.snapshot().status === 'failed' && wrongHostRuns === 0, 'Saved edits cannot relabel a still-live transport');
const unsupported = new AssessmentController(subject, port);
await unsupported.start({ kind: 'vulnerabilities' } as unknown as AssessmentRequest);
check(unsupported.snapshot().status === 'failed' && beginCalls === 1, 'Removed VA requests fail before admission');
check(!requestError(request), 'Hardening does not require online consent');
const failure = new AssessmentController(subject, { ...port, begin: async () => { throw new Error('Host collection unavailable'); } });
await failure.start(request);
check(failure.snapshot().status === 'failed', 'Failed assessment is not an empty clean report');

const authenticationReport = deferred<AssessmentReport>();
let answered = 0;
let needsAuthentication = true;
const secretSnapshots: string[] = [];
const authentication = new AssessmentController(subject, { ...port,
    begin: async () => ({ id: 'authentication', identity }), run: async () => authenticationReport.promise,
    needsPassword: async () => needsAuthentication,
    authenticate: async (id, password) => { check(id === 'authentication' && password === 'fixture-secret', 'Password goes only to its native challenge'); answered++; needsAuthentication = false; },
});
const unsubscribe = authentication.subscribe(() => secretSnapshots.push(JSON.stringify(authentication.snapshot())));
const authenticationRun = authentication.start({ ...request, elevationConsent: true });
const waitUntil = Date.now() + 2000;
while (Date.now() < waitUntil) { const snapshot = authentication.snapshot(); if (snapshot.status === 'running' && snapshot.authenticationRequired) break; await new Promise(resolve => setTimeout(resolve, 10)); }
const challenged = authentication.snapshot();
check(challenged.status === 'running' && challenged.authenticationRequired, 'Only a native challenge opens the password input');
await authentication.authenticate('fixture-secret');
await authentication.authenticate('fixture-secret');
check(answered === 1, 'A password is submitted at most once to the run-bound mailbox');
authenticationReport.resolve(report);
await authenticationRun;
check(authentication.snapshot().status === 'completed', 'Authenticated collection can finish');
check(secretSnapshots.every(snapshot => !snapshot.includes('fixture-secret')), 'No password enters published states, completed results or exports');
unsubscribe();
check(referenceUrl('https://man.openbsd.org/sshd_config') !== null, 'Reviewed hardening references are navigable');
check(referenceUrl('https://ubuntu.com/server/docs/how-to/software/automatic-updates/') !== null, 'The reviewed update/reboot source is navigable');
for (const url of ['javascript:alert(1)', 'https://osv.dev/vulnerability/CVE-fixture', 'https://man.openbsd.org.evil.invalid/sshd_config', 'https://man.openbsd.org/sshd_config?redirect=evil', 'https://evil.invalid']) check(referenceUrl(url) === null, 'Untrusted or removed advisory navigation is rejected');
const findings: Finding[] = ['passed', 'attention', 'notAssessed', 'informational'].map((status, index) => ({
    id: `CHECK-${index}`, status: status as Finding['status'], title: 'Fixture', target: '/fixture', evidence: 'fixture',
    recommendation: 'Review host policy', reference: 'https://man.openbsd.org/sshd_config',
}));
const coverageFixtures: Finding[] = [
    { ...findings[0], status: 'passed', needsElevatedAccess: true, sudoRetryEligible: true },
    { ...findings[0], status: 'attention', sudoRetryEligible: true },
    { ...findings[0], status: 'notAssessed', needsElevatedAccess: true, sudoRetryEligible: true },
    { ...findings[0], status: 'notAssessed', sudoRetryEligible: true },
    { ...findings[0], status: 'notAssessed' },
    { ...findings[0], status: 'informational', sudoRetryEligible: true },
];
const coverageSnapshot = JSON.stringify(coverageFixtures);
check(JSON.stringify(hardeningCoverage(coverageFixtures)) === JSON.stringify({ evaluated: 3, elevated: 1, unavailable: 2, notApplicable: 0, passed: 1, attention: 1, informational: 1 }), 'Coverage groups are disjoint and information counts as evaluated without counting as attention or passed');
check(findingStatusLabel(findings[1]) === 'Needs attention' && findingStatusLabel(findings[3]) === 'Informational', 'Attention and contextual observations have distinct labels');
check(filterFindings(coverageFixtures, '', 'attention').length === 1 && filterFindings(coverageFixtures, '', 'informational').length === 1, 'Attention and information filters agree with their counts');
check(hardeningCoverage([]).evaluated === 0, 'An empty report cannot imply complete coverage');
check(filterFindings(coverageFixtures, '', 'needsElevatedAccess').length === 1, 'The elevated-access filter matches its summary count');
check(filterFindings(coverageFixtures, '', 'evidenceUnavailable').length === 2, 'Other unavailable evidence is a distinct result filter');
check(filterFindings(coverageFixtures, '', 'notAssessed').length === 3, 'Underlying unavailable export status stays compatible');
check(findingSudoRetryLabel(coverageFixtures[2]) === 'Retry with sudo', 'Verified denial has a retry action');
check(findingSudoRetryLabel(coverageFixtures[3]) === 'Try with sudo' && findingStatusLabel(coverageFixtures[3]) === 'Evidence unavailable', 'Optional elevation never relabels an uncertain failure as access denied');
for (const index of [0, 1, 4, 5]) check(findingSudoRetryLabel(coverageFixtures[index]) === undefined, 'Assessed results and unqualified old failures cannot suggest sudo');
const retryReport: AssessmentReport = { ...report, collectorUid: 1000, elevationRequested: false, findings: coverageFixtures };
check(hardeningSudoRetryLabel(retryReport) === 'Retry with sudo', 'Summary prioritizes a confirmed denial when both types exist');
check(hardeningSudoRetryLabel({ ...retryReport, findings: [coverageFixtures[3]] }) === 'Try with sudo', 'A report with only eligible uncertain failures still offers approved elevation');
for (const patch of [{ collectorUid: 0 }, { collectorUid: undefined }, { collectorUid: null }, { collectorUid: NaN }, { collectorUid: -1 }, { elevationRequested: true }, { elevationRequested: undefined }]) {
    check(hardeningSudoRetryLabel({ ...retryReport, ...patch }) === undefined, 'Root, unknown privileges and already-approved sudo reports cannot offer elevated retry');
}
check(hardeningAccessLabel(retryReport) === 'Standard access', 'Known unelevated user access is disclosed');
check(hardeningAccessLabel({ collectorUid: 1000, elevationRequested: true }) === 'Sudo allowed', 'Authorization does not claim that elevation succeeded');
check(hardeningAccessLabel({ collectorUid: 0, elevationRequested: false }) === 'Root session', 'A root connection is not mislabeled standard access');
check(hardeningAccessLabel({}) === 'Access not recorded', 'Old missing access metadata is not guessed');
check(JSON.stringify(coverageFixtures) === coverageSnapshot, 'Coverage, filters and retry presentation never mutate exports');
check(findingSummary({ ...findings[0], id: 'SSH-pubkeyauthentication', status: 'notAssessed' }) === 'Zync could not collect enough information for this check.', 'Old unavailable summaries do not infer a cause or security rule from an identifier');
check(findingSummary({ ...findings[0], status: 'notAssessed', needsElevatedAccess: true }) === 'Your SSH account was denied access to information for this check.', 'Verified restricted evidence has a short access explanation');
check(findingSummary({ ...findings[0], status: 'notAssessed' }) === 'Zync could not collect enough information for this check.', 'Other unavailable summaries stay generic without guessing a cause');
check(findingSummary({ ...findings[0], status: 'passed', needsElevatedAccess: true }) === 'This check meets the expected condition.', 'A stale access flag cannot override an assessed result');
check(findingSummary({ ...findings[0], status: 'attention' }).includes('requirements'), 'Attention summaries preserve contextual interpretation');
check(findingSummary({ ...findings[0], status: 'informational' }) === 'Information to review. This check has no automatic pass or fail result.', 'Information never suggests a failed security check');
const nativeObservation: Finding = { ...findings[0], status: 'informational', observed: 'Password sign-in is disabled in the default SSH configuration.', expected: 'Compare this default with the host’s needs.', rationale: 'Context matters.', scope: 'Default configuration; Match policy not verified.', ruleVersion: '1', reviewedAt: '2026-10-25' };
check(findingSummary(nativeObservation) === nativeObservation.observed, 'Concise native observations replace generic state prose without parsing evidence');
check(findingSummary({ ...nativeObservation, id: 'CUSTOM-id' }) === nativeObservation.observed, 'Presentation has no identifier-based security interpretation');
const notApplicable: Finding = { ...nativeObservation, status: 'notApplicable', observed: 'Not applicable to this host.', applicabilityReason: 'The detected platform does not use this package profile.', needsElevatedAccess: true, sudoRetryEligible: true };
check(findingStatusLabel(notApplicable) === 'Not applicable' && findingSudoRetryLabel(notApplicable) === undefined, 'Inapplicability cannot become an access denial or suggest sudo even with stale flags');
check(JSON.stringify(hardeningCoverage([notApplicable])) === JSON.stringify({ evaluated: 0, elevated: 0, unavailable: 0, notApplicable: 1, passed: 0, attention: 0, informational: 0 }), 'Inapplicability is excluded from evaluated and unavailable totals');
check(filterFindings([notApplicable, ...coverageFixtures], '', 'notApplicable').length === 1, 'Not-applicable checks have their own filter');
check(filterFindings([notApplicable], '', 'evidenceUnavailable').length === 0 && filterFindings([notApplicable], '', 'needsElevatedAccess').length === 0, 'Unavailable filters never absorb not-applicable checks');
check(hardeningSudoRetryLabel({ ...retryReport, findings: [notApplicable] }) === undefined, 'A report with only not-applicable checks cannot suggest elevation');
for (const query of ['password sign-in', 'match policy', 'context matters']) check(filterFindings([nativeObservation], query).length === 1, 'Search covers native observations, scope and rationale');
check(filterFindings([notApplicable], 'package profile').length === 1, 'Search covers the native applicability reason');
check(filterFindings(findings, 'fixture').map(item => item.status).join(',') === 'attention,notAssessed,informational,passed', 'Attention sorts first, then unavailable evidence, information and passes');
check(findings[0].status === 'passed', 'Filtering does not mutate the retained report');
check(filterFindings(findings, 'CHECK-2', 'notAssessed').length === 1, 'Search and status compose');
check(filterFindings([{ ...findings[0], status: 'passed' }], '', 'attention').length === 0, 'Status filtering excludes other result types');
check(filterFindings([{ ...findings[0], category: 'Network' }, { ...findings[1], category: 'Accounts' }], '', 'all', 'Network').length === 1, 'Category filtering separates independent check families');
check(filterFindings(findings, 'host policy').length === 4, 'Search includes recommendation text as advertised');
check(SPLIT_FEATURE_IDS.includes('security') && builtinWorkspaceViewLabel('security') === 'Security', 'Kind-agnostic workspace registration');
check(buildWorkspaceOpenItems({ shells: [], canOpenFeature: true }).some(item => item.featureId === 'security'), 'Workspace Open discovers Security');
console.log('Security ownership, consent, coverage, filtering and workspace regressions passed.');
export {};
