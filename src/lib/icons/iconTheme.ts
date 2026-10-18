import type { InstalledPlugin } from '../../features/plugins/types';

/** Version 1 declarative contribution. Paths are package-relative static SVG assets, validated natively. */
export interface IconThemeDefinition {
  version: 1;
  iconDefinitions: Record<string, { iconPath: string }>;
  file: string;
  folder: string;
  fileNames?: Record<string, string>;
  fileExtensions?: Record<string, string>;
  folderNames?: Record<string, string>;
}

/** Built-in identities cannot be shadowed by a same-ID external package, including when disabled. */
export function findIconTheme(plugins: readonly InstalledPlugin[], id: string): InstalledPlugin | undefined {
  const matches = plugins.filter(plugin => plugin.manifest.type === 'icon-theme' && plugin.manifest.id === id);
  const plugin = matches.find(candidate => candidate.path.startsWith('builtin://')) ?? matches[0];
  return plugin?.enabled ? plugin : undefined;
}

/** Every picker and count derives from the host registry, never a second built-in-choice list. */
export function iconThemeOptions(plugins: readonly InstalledPlugin[]): Array<{ id: string; label: string }> {
  return [...new Set(plugins.filter(plugin => plugin.manifest.type === 'icon-theme').map(plugin => plugin.manifest.id))]
    .flatMap(id => { const plugin = findIconTheme(plugins, id); return plugin ? [{ id, label: plugin.manifest.name }] : []; });
}

const compiled = new WeakMap<IconThemeDefinition, { files: Map<string, string>; folders: Map<string, string>; extensions: Array<[string, string]> }>();

/** Exact names win, then the longest compound extension. Associations affect artwork, never file identity. */
export function declaredIconId(name: string, folder: boolean, theme: IconThemeDefinition): string {
  let mappings = compiled.get(theme);
  if (!mappings) {
    const entries = (value: Record<string, string> | undefined) => Object.entries(value ?? {}).map(([key, id]) => [key.toLowerCase(), id] as [string, string]);
    mappings = { files: new Map(entries(theme.fileNames)), folders: new Map(entries(theme.folderNames)),
      extensions: entries(theme.fileExtensions).sort((a, b) => b[0].length - a[0].length) };
    compiled.set(theme, mappings);
  }
  const leaf = name.toLowerCase();
  const id = folder ? mappings.folders.get(leaf) ?? theme.folder
    : mappings.files.get(leaf) ?? mappings.extensions.find(([extension]) => leaf.endsWith(`.${extension}`))?.[1] ?? theme.file;
  return Object.prototype.hasOwnProperty.call(theme.iconDefinitions, id) ? id : folder ? theme.folder : theme.file;
}

const revisions = new WeakMap<InstalledPlugin, string>();
let resourceGeneration = 0;

/** A fresh host registry record starts a new resource generation, including same-version local edits. */
export function iconThemeRevision(plugin: InstalledPlugin): string {
  let revision = revisions.get(plugin);
  if (!revision) { revision = `${plugin.manifest.version}:${++resourceGeneration}`; revisions.set(plugin, revision); }
  return revision;
}
