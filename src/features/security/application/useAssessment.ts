import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AssessmentController } from './assessmentController';
import { assessmentIpc } from '../infrastructure/assessmentIpc';
import type { AssessmentSubject } from '../domain/assessment';

/** Host/connection epochs own reports. Closing or reconnecting cancels, hiding does not rerun. */
export function useAssessment(subject: AssessmentSubject, connected: boolean, lastConnected: number | undefined) {
    const { connectionId, name, host, username, port } = subject;
    const controller = useMemo(() => new AssessmentController({ connectionId, name, host, username, port }, assessmentIpc),
        [connectionId, name, host, username, port, connected, lastConnected]);
    const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
    useEffect(() => () => controller.cancel(), [controller]);
    return { state, controller };
}
