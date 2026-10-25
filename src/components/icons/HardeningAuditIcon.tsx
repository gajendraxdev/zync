import { forwardRef, memo } from 'react';
import { Scan, type LucideProps } from 'lucide-react';
import { OSIcon } from './OSIcon';

type HardeningAuditIconProps = LucideProps & { osIcon?: string };

/** Shared audit mark: scan corners, bundled host artwork and a magnifier. */
export const HardeningAuditIcon = memo(forwardRef<SVGSVGElement, HardeningAuditIconProps>(
    function HardeningAuditIcon({ osIcon, ...props }, ref) {
        const icon = osIcon?.trim();
        return <Scan ref={ref} aria-hidden="true" {...props}>
            <foreignObject x={5.5} y={5} width={11} height={12}>
                <OSIcon icon={icon && icon.toLowerCase() !== 'server' ? icon : 'linux'} className="block h-full w-full object-contain" />
            </foreignObject>
            <circle cx={15} cy={15} r={2.5} />
            <path d="m17 17 1.5 1.5" />
        </Scan>;
    },
));
