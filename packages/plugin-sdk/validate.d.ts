export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export declare const knownPermissionIds: readonly string[];
export declare const pluginApiVersion: string;
/** Minimum desktop release planned for package-relative pane resources. */
export declare const externalPaneAssetsMinZyncVersion: string;
/** Asset response types supported by isolated pane documents. */
export declare const paneAssetMimeTypes: Readonly<Record<string, string>>;

export interface CompatibilityTarget {
  zyncVersion?: string;
  pluginApiVersion?: string;
}

/** Authoring preflight. Native install validation remains authoritative. */
export function validateManifest(manifest: unknown, target?: CompatibilityTarget): ValidationResult;

/** Checks manifest.json, referenced assets, and basic package limits without modifying the directory. */
export function validatePackageDirectory(directory: string, target?: CompatibilityTarget): ValidationResult;
