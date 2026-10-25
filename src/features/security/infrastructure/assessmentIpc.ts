import type { AssessmentPort } from '../application/assessmentController';
import type { AssessmentResult } from '../domain/assessment';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { parseAssessmentCatalog } from '../domain/modules';
import type { RiskException } from '../domain/review';

/** One local catalog supplies compatible native presets and module metadata without host discovery. */
export async function loadAssessmentCatalog() {
    return parseAssessmentCatalog(await window.ipcRenderer.invoke('security_assessment_catalog'));
}

/** Native-only fixed command boundary; no renderer-supplied programs or argument arrays. */
export const assessmentIpc: AssessmentPort = {
    /** Acknowledge admission before issuing the long-running native request. */
    begin: subject => window.ipcRenderer.invoke('security_assessment_begin', { connectionId: subject.connectionId,
        expected: { host: subject.host, username: subject.username, port: subject.port } }),
    /** Request a bounded normalized report for the registered transport. */
    run: async (id, request, credentials = []) => {
        try { return await invoke('security_assessment_run', { id, request, credentials }); }
        catch { throw new Error('The assessment could not finish. Check the connection and application access details, then try again.'); }
    },
    /** Retain cancellation even when execution has not yet claimed admission. */
    cancel: id => window.ipcRenderer.invoke('security_assessment_cancel', { id }),
    /** A run-scoped status bit is polled only while explicitly authorized collection is active. */
    needsPassword: id => invoke('security_assessment_needs_password', { id }),
    /** Bypass generic IPC error logging; neither arguments nor native errors can reflect a secret. */
    authenticate: async (id, password) => {
        try { await invoke('security_assessment_authenticate', { id, password }); }
        catch { throw new Error('Zync could not send the sudo password.'); }
    },
};

/** Native import bounds and normalizes inert report data; picking a file never executes an assessment. */
export async function importAssessment(): Promise<AssessmentResult | undefined> {
    const path = await open({ multiple: false, filters: [{ name: 'JSON report', extensions: ['json'] }] });
    if (typeof path !== 'string') return undefined;
    return window.ipcRenderer.invoke('security_assessment_import_report', { path });
}

/** Accepted risks leave the pane only through this explicit local save action. */
export async function exportRiskExceptions(annotations: readonly RiskException[]): Promise<boolean> {
    const path = await save({ defaultPath: 'zync-assessment-accepted-risks.json', filters: [{ name: 'JSON annotations', extensions: ['json'] }] });
    if (!path) return false;
    await window.ipcRenderer.invoke('fs_write_file', { connectionId: 'local', path, content: JSON.stringify({ version: 1, annotations }, null, 2) });
    return true;
}

/** Native validation retains only bounded annotation data, without applying it to findings or issuing commands. */
export async function importRiskExceptions(): Promise<RiskException[] | undefined> {
    const path = await open({ multiple: false, filters: [{ name: 'JSON annotations', extensions: ['json'] }] });
    if (typeof path !== 'string') return undefined;
    return window.ipcRenderer.invoke('security_assessment_import_annotations', { path });
}
