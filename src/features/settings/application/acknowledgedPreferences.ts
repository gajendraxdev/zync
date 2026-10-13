export interface PreferencesSnapshot {
    loading: boolean;
    /** Increment at the start of every reload, including when the key is absent. */
    generation: number;
    value: unknown;
}
export type PreferencesExpected<T> = { exists: false } | { exists: true; value: T };
export interface AcknowledgedPreferencesPort<T> {
    read(): PreferencesSnapshot;
    save(expected: PreferencesExpected<T>, value: T): Promise<void>;
    /** Compare generation and raw value before publishing; preserve unrelated settings. */
    publish(before: PreferencesSnapshot, value: T): boolean;
}

export type PreferencesQueue = <T>(run: () => Promise<T>) => Promise<T>;

/** Share ordering between editors that write overlapping fields; failures never poison the queue. */
export function createPreferencesQueue(): PreferencesQueue {
    let pending: Promise<unknown> = Promise.resolve();
    return run => {
        const result = pending.then(run, run);
        pending = result.then(() => undefined, () => undefined);
        return result;
    };
}

interface PreferencePolicy<T, A> {
    parse(value: unknown): T | null;
    /** Copy/validate intent immediately, before asynchronous queue ownership begins. */
    prepare(action: A): A | null;
    change(current: T, action: A): T | null;
    invalid: string;
    unsupported: string;
    superseded: string;
}

/**
 * Share acknowledgement, queue and reload semantics across bounded preference editors.
 * Codecs supply canonical output so JSON comparison detects semantic no-ops. Native
 * save must compare expected data under its mutation lock and accept identical retries.
 * This service never optimistically publishes or rolls back over newer settings.
 */
export function createAcknowledgedPreferencesUpdater<T, A>(
    port: AcknowledgedPreferencesPort<T>, policy: PreferencePolicy<T, A>,
    schedule: PreferencesQueue = createPreferencesQueue(),
): (action: A) => Promise<void> {
    // A rejected acknowledgement may follow a successful disk write. Until native
    // state is confirmed, even an apparent no-op/reset must compare against disk.
    let uncertain = false;
    return action => {
        const change = policy.prepare(action);
        if (change === null) return Promise.reject(new Error(policy.invalid));
        const run = async () => {
            const before = port.read();
            if (before.loading) throw new Error('Wait for settings to finish loading.');
            const current = policy.parse(before.value);
            if (current === null) throw new Error(policy.unsupported);
            const next = policy.change(current, change);
            if (next === null) throw new Error(policy.invalid);
            if (!uncertain && JSON.stringify(current) === JSON.stringify(next)) return;
            try {
                await port.save(before.value === undefined ? { exists: false } : { exists: true, value: current }, next);
                if (!port.publish(before, next)) throw new Error(policy.superseded);
                uncertain = false;
            } catch (error) {
                uncertain = true;
                throw error;
            }
        };
        return schedule(run);
    };
}
