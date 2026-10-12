import { useSyncExternalStore } from 'react';
import { getTabDockLive, subscribeTabDock } from './session';
import { dockTargetPresentation } from './dropPresentation';

/** Render the current destination without effect-driven extra frames or stale fades. */
export function TabDockOverlay() {
    const target = useSyncExternalStore(subscribeTabDock, () => getTabDockLive()?.target ?? null, () => null);
    if (!target) return null;
    const { preview } = target;
    const description = dockTargetPresentation(target);

    return (
        <div className="absolute inset-0 z-40 pointer-events-none" aria-hidden>
            <div
                data-pane-drop-mode={description.mode}
                className="tab-dock-preview absolute flex items-center justify-center overflow-hidden rounded-lg bg-app-accent/10"
                style={{
                    left: preview.left,
                    top: preview.top,
                    width: preview.width,
                    height: preview.height,
                }}
            >
                <div className="max-w-full rounded-md bg-app-panel px-3 py-2 text-center text-xs font-medium text-app-text">
                    <span className="block">{description.title}</span>
                    <span className="block mt-1 text-[10px] text-app-muted">{description.detail}</span>
                </div>
            </div>
        </div>
    );
}
