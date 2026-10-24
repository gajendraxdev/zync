import type { AssessmentPort } from '../application/assessmentController';
import type { AssessmentResult } from '../domain/assessment';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

/** Native-only fixed command boundary; no renderer-supplied programs or argument arrays. */
export const assessmentIpc: AssessmentPort = {
    /** Acknowledge admission before issuing the long-running native request. */
    begin: subject => window.ipcRenderer.invoke('security_assessment_begin', { connectionId: subject.connectionId,
        expected: { host: subject.host, username: subject.username, port: subject.port } }),
    /** Request a bounded normalized report for the registered transport. */
    run: (id, request) => window.ipcRenderer.invoke('security_assessment_run', { id, request }),
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

/** Export only the normalized report after the user explicitly chooses a local destination. */
export async function exportAssessment(result: AssessmentResult): Promise<boolean> {
    const path = await save({ defaultPath: `zync-${result.report.kind}-assessment.json`, filters: [{ name: 'JSON report', extensions: ['json'] }] });
    if (!path) return false;
    await window.ipcRenderer.invoke('fs_write_file', { connectionId: 'local', path, content: JSON.stringify({ version: 2, ...result }, null, 2) });
    return true;
}
