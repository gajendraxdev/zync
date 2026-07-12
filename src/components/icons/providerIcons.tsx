import type { SVGProps } from 'react';
import { cn } from '../../lib/utils';

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
  /** `color` = official Google multicolor G; `mono` = currentColor (chips / muted UI). */
  variant?: 'color' | 'mono';
};

/**
 * Filled “this device” mark — solid weight next to brand marks.
 * Uses muted theme tokens (not accent purple) so chips stay quiet in host lists.
 */
export function LocalDeviceIcon({
  size = 12,
  className,
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden
      {...rest}
    >
      {/* Chassis — muted, not accent */}
      <rect
        x="2.5"
        y="4"
        width="19"
        height="12.5"
        rx="2.2"
        fill="var(--color-app-muted)"
        opacity={0.72}
      />
      {/* Screen — panel surface so it matches theme */}
      <rect
        x="4.5"
        y="6"
        width="15"
        height="8.5"
        rx="1"
        fill="var(--color-app-surface)"
        opacity={0.95}
      />
      {/* Screen highlight */}
      <rect
        x="5.5"
        y="7"
        width="6"
        height="2.5"
        rx="0.6"
        fill="var(--color-app-text)"
        opacity={0.12}
      />
      {/* Base / deck */}
      <path
        d="M1.5 18.25h21a1.1 1.1 0 0 1 0 2.2H1.5a1.1 1.1 0 0 1 0-2.2z"
        fill="var(--color-app-muted)"
        opacity={0.55}
      />
      {/* Trackpad hint */}
      <rect
        x="10"
        y="18.55"
        width="4"
        height="0.9"
        rx="0.4"
        fill="var(--color-app-bg)"
        opacity={0.75}
      />
    </svg>
  );
}

/**
 * Official-style Google “G” mark.
 * Prefer this over Lucide `Cloud` anywhere the product means Google / Google Drive.
 */
export function GoogleMarkIcon({
  size = 16,
  variant = 'mono',
  className,
  ...rest
}: IconProps) {
  const isColor = variant === 'color';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden
      {...rest}
    >
      {isColor ? (
        <>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09A6.97 6.97 0 0 1 5.5 12c0-.72.13-1.43.34-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.94.46 3.77 1.18 5.39l3.66-2.84.01-.46z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </>
      ) : (
        <g fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            opacity={0.9}
          />
          <path
            d="M5.84 14.09A6.97 6.97 0 0 1 5.5 12c0-.72.13-1.43.34-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.94.46 3.77 1.18 5.39l3.66-2.84.01-.46z"
            opacity={0.78}
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            opacity={0.92}
          />
        </g>
      )}
    </svg>
  );
}

/** Simplified Google Drive triangle (optional alternate for Drive-specific chrome). */
export function GoogleDriveIcon({
  size = 16,
  variant = 'mono',
  className,
  ...rest
}: IconProps) {
  const isColor = variant === 'color';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden
      {...rest}
    >
      {isColor ? (
        <>
          <path fill="#4285F4" d="M8.5 4 3 14h5.5L14 4H8.5z" />
          <path fill="#EA4335" d="M14 4 8.5 14H19.5L14 4z" />
          <path fill="#34A853" d="M3 14 5.75 19.5h12.5L21 14H3z" />
        </>
      ) : (
        <g fill="currentColor">
          <path d="M8.5 4 3 14h5.5L14 4H8.5z" opacity={0.95} />
          <path d="M14 4 8.5 14H19.5L14 4z" opacity={0.7} />
          <path d="M3 14 5.75 19.5h12.5L21 14H3z" opacity={0.55} />
        </g>
      )}
    </svg>
  );
}
