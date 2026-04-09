import { normalizeFolderPath, normalizePort, normalizeText } from './normalization.js';

export interface ConnectionDraft {
    name?: string;
    host?: string;
    username?: string;
    port?: number | string;
    password?: string;
    privateKeyPath?: string;
    folder?: string;
}

export type AuthMode = 'password' | 'key';

export interface ValidationResult {
    ok: boolean;
    errors: string[];
    normalizedPort: number;
    normalizedFolder: string;
}

export const hasRequiredHostAndUsername = (draft: ConnectionDraft): boolean =>
    !!normalizeText(draft.host) && !!normalizeText(draft.username);

export const validateConnectionDraft = (draft: ConnectionDraft, authMode: AuthMode): ValidationResult => {
    const errors: string[] = [];
    const normalizedPort = normalizePort(draft.port);
    const normalizedFolder = normalizeFolderPath(draft.folder);

    if (!hasRequiredHostAndUsername(draft)) {
        if (!normalizeText(draft.host)) errors.push('Host is required.');
        if (!normalizeText(draft.username)) errors.push('Username is required.');
    }
    if (authMode === 'key' && !normalizeText(draft.privateKeyPath)) {
        errors.push('Private key path is required for key auth.');
    }

    // Keep parity with current app behavior: invalid ports normalize to 22.
    // This validation only guards hard-invalid values that become NaN before normalize.
    if (draft.port !== undefined && Number.isNaN(Number(draft.port))) {
        errors.push('Port must be a valid number.');
    }

    return { ok: errors.length === 0, errors, normalizedPort, normalizedFolder };
};
