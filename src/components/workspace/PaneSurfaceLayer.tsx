import { useLayoutEffect, useState, type ReactNode } from 'react';
import { retainPaneSurfaces, type PaneSurface } from './paneSurfaces';

export function PaneSurfaceLayer({
    surfaces, renderSurface, registerHost,
}: {
    surfaces: readonly PaneSurface[];
    renderSurface: (surface: PaneSurface) => ReactNode;
    registerHost: (key: string, node: HTMLDivElement | null) => void;
}) {
    const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
    const retained = retainPaneSurfaces(surfaces, visited);

    useLayoutEffect(() => {
        setVisited(previous => {
            const next = new Set(retainPaneSurfaces(surfaces, previous).map(surface => surface.key));
            return next.size === previous.size && [...next].every(key => previous.has(key)) ? previous : next;
        });
    }, [surfaces]);

    return <>
        {retained.map(surface => (
            <div
                key={surface.key}
                ref={node => registerHost(surface.key, node)}
                data-pane-surface={surface.key}
                className="absolute z-10 overflow-hidden"
                style={{ display: surface.visible ? undefined : 'none', visibility: 'hidden' }}
            >
                {renderSurface(surface)}
            </div>
        ))}
    </>;
}
