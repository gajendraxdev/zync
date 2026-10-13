import type { ReactNode } from 'react';
import type { NavigationPosition } from '../../../features/workspace/domain/navigation';

/** Change allocation, never parentage: the body and its live iframe descendants stay in one stable cell. */
export function NavigationFrame({ position, navigation, children }: {
    position: NavigationPosition; navigation: ReactNode; children: ReactNode;
}) {
    const horizontal = position === 'top' || position === 'bottom';
    return <div data-navigation-frame className="flex-1 min-h-0 min-w-0 grid overflow-hidden relative"
        style={{ gridTemplateColumns: 'auto minmax(0, 1fr) auto', gridTemplateRows: 'auto minmax(0, 1fr) auto' }}>
        <div data-navigation-slot="" className="min-h-0 min-w-0 overflow-hidden"
            style={{ gridRow: position === 'top' ? 1 : position === 'bottom' ? 3 : 2,
                gridColumn: horizontal ? 2 : position === 'left' ? 1 : 3, maxWidth: horizontal ? undefined : 'min(220px, 40vw)' }}>
            {navigation}
        </div>
        <div data-workspace-body="" className="min-h-0 min-w-0 flex overflow-hidden relative" style={{ gridRow: 2, gridColumn: 2 }}>
            {children}
        </div>
    </div>;
}
