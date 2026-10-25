import type { AssessmentResult, AssessmentSubject } from './assessment';
import type { RiskException } from './review';
import type { SavedRisk } from './acceptedRisks';

export type ReportExportFormat = 'json' | 'csv' | 'xlsx';
export interface ReportPackage { result: AssessmentResult; annotations: RiskException[] }
export interface SavedReportSummary {
    id: string; name: string; revision: number; createdAt: number; updatedAt: number; completedAt: number;
    host: string; username: string; port: number; fingerprint?: string | null; baseline: string;
    findings: number; attention: number; bytes: number;
}
export interface SavedReport extends ReportPackage { summary: SavedReportSummary }
export type ReportRevision = Pick<SavedReportSummary, 'id' | 'revision'>;
export interface ReportLibraryPort {
    list(subject: AssessmentSubject): Promise<SavedReportSummary[]>;
    load(id: string, subject: AssessmentSubject): Promise<SavedReport>;
    save(result: AssessmentResult, annotations: readonly RiskException[], name: string, replace?: ReportRevision): Promise<SavedReportSummary>;
    delete(revision: ReportRevision, subject: AssessmentSubject, riskRevisions?: readonly ReportRevision[]): Promise<void>;
    risks(subject: AssessmentSubject): Promise<SavedRisk[]>;
    saveRisks(result: AssessmentResult, annotations: readonly RiskException[], revisions: readonly ReportRevision[]): Promise<SavedRisk[]>;
    removeRisk(revision: ReportRevision, subject: AssessmentSubject): Promise<void>;
}

/** Importing an earlier connection ID is allowed; its endpoint and SSH account must still match the pane. */
export function reportBelongsToHost(result: AssessmentResult, subject: AssessmentSubject): boolean {
    return result.subject.host === subject.host && result.subject.username === subject.username && result.subject.port === subject.port;
}

/** A portable package keeps explicitly accepted risks with evidence, without any runtime access inputs. */
export function reportPayload(result: AssessmentResult, annotations: readonly RiskException[]): string {
    return JSON.stringify({ version: 3, subject: result.subject, report: result.report, startedAt: result.startedAt, completedAt: result.completedAt, annotations });
}

/** A replacement keeps the same endpoint/account and recorded key, including explicitly unqualified legacy reports. */
export function replacementReports(result: AssessmentResult, reports: readonly SavedReportSummary[]): SavedReportSummary[] {
    return reports.filter(item => item.host === result.subject.host && item.username === result.subject.username && item.port === result.subject.port
        && (item.fingerprint ?? undefined) === (result.report.transportFingerprint ?? undefined));
}
