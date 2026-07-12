import type { ComponentType, SVGProps } from 'react';
import {
  GitBranch,
  HardDrive,
  Server,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { HostLocationTag } from '../../../features/connections/domain/hostCatalog';
import { GoogleMarkIcon, LocalDeviceIcon } from '../../icons/providerIcons';
import { Tooltip } from '../../ui/Tooltip';

type LocationIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

type LocationMeta = {
  label: string;
  title: string;
  Icon: LocationIcon;
  className: string;
  brand?: 'google' | 'local';
};

/** Shared chip chrome — always uses theme surface/border tokens. */
const CHIP_BASE =
  'border-[var(--color-app-border)]/50 bg-[var(--color-app-surface)]/90 text-[var(--color-app-muted)]';

/** Shared meta for custom/backend tags so labels cannot drift. */
const BACKEND_LOCATION_META: LocationMeta = {
  label: 'Backend',
  title: 'Available from custom backend',
  Icon: Server,
  className: cn(CHIP_BASE, 'text-amber-400/90'),
};

/**
 * Icon-only location badges. Backgrounds follow app theme tokens so light/dark
 * and custom themes stay consistent. Brand marks keep fixed brand colors only
 * on the glyph itself (Google G); local device uses muted tokens (not accent).
 */
const LOCATION_META: Record<string, LocationMeta> = {
  local: {
    label: 'Local',
    title: 'On this device',
    Icon: LocalDeviceIcon,
    className: CHIP_BASE,
    brand: 'local',
  },
  google: {
    label: 'Google',
    title: 'Available from Google Drive',
    Icon: GoogleMarkIcon,
    className: CHIP_BASE,
    brand: 'google',
  },
  git: {
    label: 'Git',
    title: 'Available from Git',
    Icon: GitBranch,
    className: cn(CHIP_BASE, 'text-violet-400/90'),
  },
  custom: BACKEND_LOCATION_META,
  backend: BACKEND_LOCATION_META,
  s3: {
    label: 'S3',
    title: 'Available from S3',
    Icon: HardDrive,
    className: cn(CHIP_BASE, 'text-orange-400/90'),
  },
};

function resolveLocationMeta(loc: string): LocationMeta {
  return (
    LOCATION_META[loc] ?? {
      label: loc,
      title: `Available from ${loc}`,
      Icon: Server,
      className: CHIP_BASE,
    }
  );
}

interface HostLocationChipsProps {
  locations: HostLocationTag[];
  compact?: boolean;
  className?: string;
  /**
   * If true, hide a lone "local" chip. Default false so local-only hosts still
   * show the Local badge next to multi-location rows.
   */
  hideLocalOnly?: boolean;
}

export function HostLocationChips({
  locations,
  compact,
  className,
  hideLocalOnly = false,
}: HostLocationChipsProps) {
  if (!locations.length) return null;

  const visible =
    hideLocalOnly && locations.length === 1 && locations[0] === 'local'
      ? []
      : locations;

  if (!visible.length) return null;

  const iconSize = compact ? 10 : 11;

  return (
    <div className={cn('flex flex-nowrap items-center gap-0.5 shrink-0', className)}>
      {visible.map(loc => {
        const meta = resolveLocationMeta(loc);
        const { Icon } = meta;
        return (
          <Tooltip key={loc} content={meta.title} position="top" dismissOnClick>
            <span
              role="img"
              aria-label={meta.title}
              className={cn(
                'inline-flex items-center justify-center rounded-md border cursor-default',
                compact ? 'h-4 w-4' : 'h-[18px] w-[18px]',
                meta.className,
              )}
            >
              {meta.brand === 'google' ? (
                <GoogleMarkIcon size={iconSize} variant="color" className="shrink-0" />
              ) : meta.brand === 'local' ? (
                <LocalDeviceIcon size={iconSize} className="shrink-0" />
              ) : (
                <Icon size={iconSize} className="shrink-0" strokeWidth={2.25} />
              )}
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
