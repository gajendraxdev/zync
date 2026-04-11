export const normalizeText = (value: string | undefined | null): string => (value ?? '').trim();

export interface ParsedPortResult {
    normalizedPort: number;
    error: string | null;
}

export const normalizeFolderPath = (value: string | undefined | null): string =>
{
    const raw = value ?? '';
    const cleaned = normalizeText(raw);
    const hasLeadingSlash = cleaned.startsWith('/') || raw.trim().startsWith('/');
    const normalized = cleaned
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join('/');

    if (hasLeadingSlash && !normalized) return '/';
    if (hasLeadingSlash) return `/${normalized}`;
    return normalized;
};

export const parsePort = (value: number | string | undefined | null): ParsedPortResult => {
    if (value === undefined || value === null || value === '') {
        return { normalizedPort: 22, error: null };
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        return { normalizedPort: 22, error: 'Port must be an integer between 1 and 65535.' };
    }
    return { normalizedPort: parsed, error: null };
};

export const normalizePort = (value: number | string | undefined | null): number =>
    parsePort(value).normalizedPort;

export const normalizeTags = (tags: string[] | undefined | null): string[] => {
    if (!Array.isArray(tags)) return [];

    const dedup = new Set<string>();
    for (const tag of tags) {
        const normalized = normalizeText(tag);
        if (!normalized) continue;
        dedup.add(normalized);
    }
    return Array.from(dedup);
};
