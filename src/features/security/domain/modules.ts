/** Native catalog metadata describes compiled checks; renderer choices never supply commands. */
export interface ModuleDefinition {
    id: string;
    label: string;
    description: string;
    group: 'host' | 'applications';
    checkCount: number;
    recommended: boolean;
    auth?: RuntimeAuthDefinition;
    targetLimit?: number;
    targetLabel?: string;
}

export type RuntimeCredentialKind = 'postgresql' | 'mysql' | 'redis' | 'jenkins';
export interface RuntimeAuthDefinition {
    kind: RuntimeCredentialKind;
    defaultPort: number;
    usernameRequired: boolean;
    secretRequired: boolean;
    defaultDatabase?: string;
    secretLabel: string;
    maxSecretBytes: number;
}
export interface RuntimeCredential {
    kind: RuntimeCredentialKind;
    port: number;
    username: string;
    database: string;
    secret: string;
}
export interface ScopePreset { id: string; label: string; description: string; moduleIds: string[]; revision: string }
export interface AssessmentCatalog { version: '1'; modules: ModuleDefinition[]; presets: ScopePreset[]; defaultPresetId: string }

const AUTH_KINDS: readonly string[] = ['postgresql', 'mysql', 'redis', 'jenkins'];

/** Validate bounded local credential metadata without copying native authentication policy into the UI. */
function parseAuth(value: unknown): RuntimeAuthDefinition | undefined {
    if (value === undefined || value === null) return undefined;
    const item = value as Record<string, unknown>;
    if (!item || typeof item !== 'object' || typeof item.kind !== 'string' || !AUTH_KINDS.includes(item.kind)
        || !Number.isInteger(item.defaultPort) || (item.defaultPort as number) < 1 || (item.defaultPort as number) > 65535
        || typeof item.usernameRequired !== 'boolean' || typeof item.secretRequired !== 'boolean' || typeof item.secretLabel !== 'string' || !item.secretLabel.trim() || item.secretLabel.length > 80
        || !Number.isInteger(item.maxSecretBytes) || (item.maxSecretBytes as number) < 1 || (item.maxSecretBytes as number) > 4096
        || (item.defaultDatabase != null && (typeof item.defaultDatabase !== 'string' || item.defaultDatabase.length > 128))) throw new Error('Assessment access choices are unavailable.');
    return { kind: item.kind as RuntimeCredentialKind, defaultPort: item.defaultPort as number, usernameRequired: item.usernameRequired, secretRequired: item.secretRequired,
        secretLabel: item.secretLabel, maxSecretBytes: item.maxSecretBytes as number, ...(item.defaultDatabase ? { defaultDatabase: item.defaultDatabase as string } : {}) };
}

/** Fail closed on an incomplete or malformed local catalog instead of inventing available coverage. */
export function parseModuleCatalog(value: unknown): ModuleDefinition[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new Error('Assessment check choices are unavailable.');
    const ids = new Set<string>();
    return value.map(item => {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(item.id)
            || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 100
            || typeof item.description !== 'string' || item.description.length > 500
            || !['host', 'applications'].includes(item.group) || !Number.isInteger(item.checkCount)
            || item.checkCount < 1 || item.checkCount > 1000 || typeof item.recommended !== 'boolean') {
            throw new Error('Assessment check choices are unavailable.');
        }
        ids.add(item.id);
        if (item.targetLimit != null && (!Number.isInteger(item.targetLimit) || item.targetLimit < 1 || item.targetLimit > 1000)) throw new Error('Assessment target limits are unavailable.');
        if (item.targetLabel != null && (typeof item.targetLabel !== 'string' || item.targetLabel.length > 80)) throw new Error('Assessment target choices are unavailable.');
        return { id: item.id, label: item.label, description: item.description, group: item.group,
            checkCount: item.checkCount, recommended: item.recommended, ...(item.auth ? { auth: parseAuth(item.auth) } : {}),
            ...(item.targetLimit != null ? { targetLimit: item.targetLimit } : {}), ...(item.targetLabel ? { targetLabel: item.targetLabel } : {}) };
    });
}

/** Presets are compiled native selections; remote or imported data cannot add UI execution choices. */
export function parseAssessmentCatalog(value: unknown): AssessmentCatalog {
    const item = value as Record<string, unknown>;
    if (!item || typeof item !== 'object' || item.version !== '1' || typeof item.defaultPresetId !== 'string'
        || !Array.isArray(item.presets) || item.presets.length < 1 || item.presets.length > 32) throw new Error('Assessment choices are unavailable.');
    const modules = parseModuleCatalog(item.modules);
    const ids = new Set<string>();
    const presets = item.presets.map(raw => {
        if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(raw.id) || ids.has(raw.id)
            || typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 100 || typeof raw.description !== 'string' || raw.description.length > 500
            || typeof raw.revision !== 'string' || !raw.revision || raw.revision.length > 64 || !Array.isArray(raw.moduleIds)
            || raw.moduleIds.length === 0 || raw.moduleIds.length > modules.length || new Set(raw.moduleIds).size !== raw.moduleIds.length
            || raw.moduleIds.some((id: unknown) => typeof id !== 'string' || !modules.some(module => module.id === id))) throw new Error('Assessment presets are unavailable.');
        ids.add(raw.id);
        return { id: raw.id, label: raw.label, description: raw.description, moduleIds: [...raw.moduleIds] as string[], revision: raw.revision };
    });
    if (!ids.has(item.defaultPresetId)) throw new Error('The default assessment preset is unavailable.');
    return { version: '1', modules, presets, defaultPresetId: item.defaultPresetId };
}

/** Credentials remain a separate ephemeral argument and never become a report, draft request or persisted preference. */
export function credentialError(credential: RuntimeCredential, definition?: RuntimeAuthDefinition): string | undefined {
    if (!AUTH_KINDS.includes(credential.kind) || (definition && definition.kind !== credential.kind)) return 'Choose the matching application access details.';
    if (!Number.isInteger(credential.port) || credential.port < 1 || credential.port > 65535) return 'Enter a port from 1 to 65535.';
    const encoder = new TextEncoder();
    const usernameRequired = definition?.usernameRequired ?? credential.kind !== 'redis';
    const secretRequired = definition?.secretRequired ?? (credential.kind === 'mysql' || credential.kind === 'jenkins');
    if (typeof credential.username !== 'string' || encoder.encode(credential.username).length > 128 || /\p{Cc}/u.test(credential.username)
        || (usernameRequired && !credential.username.trim()) || (credential.kind === 'jenkins' && credential.username.includes(':'))) return 'Enter a valid application username.';
    if (typeof credential.database !== 'string' || encoder.encode(credential.database).length > 128 || /\p{Cc}/u.test(credential.database)
        || (credential.kind === 'postgresql' && !credential.database.trim())) return 'Enter a valid database name.';
    const maximum = Math.min(definition?.maxSecretBytes ?? 4096, credential.kind === 'mysql' ? 79 : 4096);
    if (credential.kind === 'mysql' && typeof credential.secret === 'string' && encoder.encode(credential.secret).length > maximum) return 'This MySQL observer supports credentials up to 79 UTF-8 bytes. Keep your password unchanged and use the service checks instead.';
    if (typeof credential.secret !== 'string' || /\p{Cc}/u.test(credential.secret) || encoder.encode(credential.secret).length > maximum) return 'The password or token exceeds this observer’s limit or contains unsupported control characters.';
    if (secretRequired && !credential.secret) return 'Enter the application password or token.';
    return undefined;
}

/** Catalog order provides one stable presentation and count without reproducing native rule metadata. */
export function selectedModules(catalog: readonly ModuleDefinition[], ids: readonly string[]): ModuleDefinition[] {
    const selected = new Set(ids);
    return catalog.filter(module => selected.has(module.id));
}

/** Summarize the selected scope while keeping every module available in the chooser or report. */
export function moduleScopeSummary(modules: readonly ModuleDefinition[]): string {
    if (modules.length === 0) return 'Choose at least one area';
    const label = modules.length === 1 ? modules[0].label : `${modules[0].label} + ${modules.length - 1} more`;
    const count = modules.reduce((total, module) => total + module.checkCount, 0);
    return `${label} · ${count} ${count === 1 ? 'check' : 'checks'}`;
}

/** A completed scoped request must describe exactly its captured selection, regardless of order. */
export function sameModuleSelection(expected: readonly string[], actual: readonly ModuleDefinition[] | undefined): boolean {
    return Boolean(actual && expected.length === actual.length && new Set(actual.map(module => module.id)).size === actual.length
        && expected.every(id => actual.some(module => module.id === id)));
}
