export const normalizeText = (value: string | undefined | null): string => (value ?? '').trim();

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

export const normalizePort = (value: number | string | undefined | null): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 22;
    if (!Number.isInteger(parsed)) return 22;
    if (parsed <= 0 || parsed > 65535) return 22;
    return parsed;
};

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
