/** Read chrome identities only; the store revalidates live ownership on drop. */
export function readTabContents(element: Element | null): string[] | null {
    try {
        const value: unknown = JSON.parse(element?.getAttribute('data-workspace-tab-contents') ?? 'null');
        return Array.isArray(value) && value.length > 0 && value.length <= 4
            && value.every(id => typeof id === 'string') ? value : null;
    } catch { return null; }
}
