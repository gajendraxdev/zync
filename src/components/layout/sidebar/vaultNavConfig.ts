import { HardDrive, type LucideIcon } from 'lucide-react';
import type { VaultProfileId } from '../../../vault/profileTypes';

export interface VaultNavItemConfig {
  id: VaultProfileId;
  label: string;
  icon: LucideIcon;
}

/** Sidebar vault submenu entries. Sync & Backup is a separate workspace tab, not listed here. */
export const VAULT_NAV_ITEMS: ReadonlyArray<VaultNavItemConfig> = [
  {
    id: 'local',
    label: 'Local Vault',
    icon: HardDrive,
  },
] as const;