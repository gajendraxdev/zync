import { useEffect, useRef, useState } from 'react';
import type { AssessmentResult } from '../domain/assessment';
import { mergeRiskExceptions, riskIdentityKey, type RiskException } from '../domain/review';
import { exportRiskExceptions, importAssessment, importRiskExceptions } from '../infrastructure/assessmentIpc';

interface ReviewState { owner: object; baseline?: AssessmentResult; baselineSource?: 'saved' | 'imported'; annotations: RiskException[] }
const NO_ANNOTATIONS: readonly RiskException[] = [];

/** Explicit file actions retain inert comparison data in this pane only, fenced to its connection owner. */
export function useAssessmentReview(owner: object, notify: (type: 'success' | 'error' | 'info', message: string) => void, clockAnnotations: readonly RiskException[] = NO_ANNOTATIONS) {
    const ownerRef = useRef(owner);
    ownerRef.current = owner;
    const pendingOperation = useRef<{ owner: object; token: object } | undefined>(undefined);
    const [state, setState] = useState<ReviewState>({ owner, annotations: [] });
    const [operation, setOperation] = useState<{ owner: object; busy: boolean }>({ owner, busy: false });
    const [now, setNow] = useState(Date.now());
    const current: ReviewState = state.owner === owner ? state : { owner, annotations: [] };
    useEffect(() => {
        pendingOperation.current = undefined;
        setState({ owner, annotations: [] }); setOperation({ owner, busy: false }); setNow(Date.now());
        return () => { pendingOperation.current = undefined; };
    }, [owner]);
    useEffect(() => { setNow(Date.now()); }, [clockAnnotations]);
    useEffect(() => {
        const next = [...current.annotations, ...clockAnnotations].flatMap(item => [item.createdAt, item.expiresAt]).filter(value => value > Date.now()).sort((a, b) => a - b)[0];
        if (!next) return;
        const timer = setTimeout(() => setNow(Date.now()), Math.max(1, Math.min(next - Date.now() + 1, 2147483647)));
        return () => clearTimeout(timer);
    }, [current.annotations, clockAnnotations, now]);

    /** Ref-based admission also excludes repeated actions before React commits the busy state. */
    const beginOperation = () => {
        if (pendingOperation.current?.owner === owner) return undefined;
        const token = {};
        pendingOperation.current = { owner, token };
        setOperation({ owner, busy: true });
        return token;
    };
    /** A late file dialog cannot release another connection's operation. */
    const finishOperation = (token: object) => {
        if (pendingOperation.current?.token !== token) return;
        pendingOperation.current = undefined;
        if (ownerRef.current === owner) setOperation({ owner, busy: false });
    };

    /** A selected local report is normalized natively and never triggers a new assessment. */
    const loadComparison = async () => {
        const token = beginOperation();
        if (!token) return;
        const capturedOwner = owner;
        try {
            const baseline = await importAssessment();
            if (pendingOperation.current?.token === token && ownerRef.current === capturedOwner && baseline) setState(previous => ({ owner, annotations: previous.owner === owner ? previous.annotations : [], baseline, baselineSource: 'imported' }));
        } catch { if (pendingOperation.current?.token === token && ownerRef.current === capturedOwner) notify('error', 'Could not read this assessment report.'); }
        finally { finishOperation(token); }
    };

    /** Import notes without replacing the current comparison or its source; matching stays finding-specific. */
    const loadAnnotations = async () => {
        const token = beginOperation();
        if (!token) return;
        const capturedOwner = owner;
        try {
            const annotations = await importRiskExceptions();
            if (pendingOperation.current?.token === token && ownerRef.current === capturedOwner && annotations) {
                setNow(Date.now());
                setState(previous => {
                    const owned = previous.owner === owner ? previous : { owner, annotations: [] };
                    return { ...owned, annotations: mergeRiskExceptions(owned.annotations, annotations) };
                });
                notify('success', 'Accepted risks loaded. Only matching, unexpired entries apply.');
            }
        } catch { if (pendingOperation.current?.token === token && ownerRef.current === capturedOwner) notify('error', 'Could not read these accepted risks.'); }
        finally { finishOperation(token); }
    };

    /** Only this action writes annotations; ordinary runs and report exports do not persist them. */
    const saveAnnotations = async (values: readonly RiskException[] = current.annotations) => {
        const token = beginOperation();
        if (!token) return;
        const capturedOwner = owner;
        const annotations = values.map(item => ({ ...item }));
        try { if (await exportRiskExceptions(annotations) && pendingOperation.current?.token === token && ownerRef.current === capturedOwner) notify('success', 'Accepted risks saved.'); }
        catch { if (pendingOperation.current?.token === token && ownerRef.current === capturedOwner) notify('error', 'Could not save accepted risks.'); }
        finally { finishOperation(token); }
    };
    return { ...current, now, busy: operation.owner === owner && operation.busy,
        loadComparison, loadAnnotations, saveAnnotations,
        /** Opening a report restores its explicit annotations without applying them to another host or evidence. */
        replaceAnnotations: (annotations: readonly RiskException[]) => { setState({ owner, annotations: [...annotations] }); setNow(Date.now()); },
        /** A selected saved report is comparison data and does not change the current assessment. */
        compareSaved: (baseline: AssessmentResult) => setState(previous => previous.owner === owner ? { ...previous, baseline, baselineSource: 'saved' } : previous),
        /** Clearing imported data is a local presentation action, not a host operation. */
        clearComparison: () => setState(previous => previous.owner === owner ? { ...previous, baseline: undefined } : previous),
        /** Accept only an explicitly created annotation, without changing retained native evidence. */
        addAnnotation: (annotation: RiskException) => { setState(previous => previous.owner === owner ? { ...previous, annotations: mergeRiskExceptions(previous.annotations, [annotation]) } : previous); setNow(Date.now()); },
        /** Removing an annotation reveals the original result; no native policy is changed. */
        removeAnnotation: (id: string) => setState(previous => previous.owner === owner ? { ...previous, annotations: previous.annotations.filter(item => item.id !== id) } : previous),
        /** Registry revocation removes matching drafts while preserving an active comparison. */
        removeBindings: (keys: ReadonlySet<string>) => setState(previous => previous.owner === owner ? { ...previous, annotations: previous.annotations.filter(item => !keys.has(riskIdentityKey(item))) } : previous),
    };
}
