const IMAGE_EXTENSION = /\.(?:svg|png|jpe?g|webp|gif|ico|avif)$/i;

export function isPluginImageIcon(icon: string | undefined): boolean {
    return typeof icon === 'string' && IMAGE_EXTENSION.test(icon);
}

/** Only package-relative images under an installed plugin's absolute root. */
export function pluginIconPath(pluginRoot: string | undefined, icon: string | undefined): string | null {
    if (!pluginRoot || !icon || !isPluginImageIcon(icon)) return null;
    const root = pluginRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    const relative = icon.replace(/\\/g, '/');
    if (!/^(?:[a-z]:\/|\/)/i.test(root) || /[\x00-\x1f\x7f?#%]/.test(root)) return null;
    if (root.split('/').some(segment => segment === '.' || segment === '..')) return null;
    if (relative.startsWith('/') || /[\x00-\x1f\x7f:%?#]/.test(relative)) return null;
    if (relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null;
    return `${root}/${relative}`;
}
