import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import {
    findNode,
    introStartSizes,
    isPaneLeaf,
    isPaneSplit,
    markSplitIntro,
    normalizeSizes,
    prefersSplitIntroMotion,
    takeSplitIntro,
    SPLIT_INTRO_MS,
    SPLIT_SETTLE_MS,
    type PaneLayout,
    type PaneNode,
    type SplitDirection,
    type SplitIntro,
} from '../../lib/paneLayout';
import { beginPaneSplitIntro, endPaneSplitIntro, type PaneTransientHold } from '../../lib/terminal';
import { useAppStore } from '../../store/useAppStore';
import { PaneDivider } from './PaneDivider';
import { paneSurfaceKey } from '../workspace/paneSurfaces';

function SplitBranch({
    grow,
    intro,
    incoming,
    dragging,
    settle,
    children,
}: {
    grow: number;
    intro: boolean;
    incoming: boolean;
    dragging: boolean;
    settle: boolean;
    children: ReactNode;
}) {
    return (
        <div
            className={cn(
                'pane-split-branch relative',
                intro && 'is-intro',
                dragging && 'is-dragging',
                settle && !intro && !dragging && 'is-settle',
            )}
            style={{ flexGrow: grow, flexShrink: 1, flexBasis: 0 }}
        >
            {children}
            {intro && incoming && <div aria-hidden className="pane-split-intro-veil" />}
        </div>
    );
}

function layoutHasSplitNode(connectionId: string, splitId: string): boolean {
    const groups = useAppStore.getState().paneLayouts[connectionId];
    if (!groups) return false;
    for (const layout of Object.values(groups)) {
        if (findNode(layout.root, splitId)) return true;
    }
    return false;
}

function SplitFrame({
    connectionId,
    splitId,
    direction,
    sizes,
    first,
    second,
    onDrag,
    onDragEnd,
    onEqualize,
}: {
    connectionId: string;
    splitId: string;
    direction: SplitDirection;
    sizes: [number, number];
    first: ReactNode;
    second: ReactNode;
    onDrag: (ratio: number) => void;
    onDragEnd: () => void;
    onEqualize: () => void;
}) {
    const [intro, setIntro] = useState<SplitIntro | null>(null);
    const [grow, setGrow] = useState<[number, number]>(sizes);
    const [dragRatio, setDragRatio] = useState<number | null>(null);
    const [settle, setSettle] = useState(false);
    const sizesRef = useRef(sizes);
    const dragRatioRef = useRef<number | null>(null);
    const dragRafRef = useRef(0);
    const cancelIntroRef = useRef<(() => void) | null>(null);
    const introHoldRef = useRef<PaneTransientHold | null>(null);

    useLayoutEffect(() => {
        sizesRef.current = sizes;
    });

    useLayoutEffect(() => {
        const taken = takeSplitIntro(splitId);
        if (!taken) return undefined;

        let finished = false;
        setIntro(taken);
        setGrow(introStartSizes(taken.incomingIndex));
        introHoldRef.current = beginPaneSplitIntro();

        const finish = (announce: boolean) => {
            if (finished) return;
            finished = true;
            cancelIntroRef.current = null;
            setGrow([sizesRef.current[0], sizesRef.current[1]]);
            setIntro(null);
            const settled = endPaneSplitIntro(introHoldRef.current);
            introHoldRef.current = null;
            if (announce && settled) {
                window.dispatchEvent(new Event('zync:pane-resize-end'));
            }
        };

        const target: [number, number] = [sizesRef.current[0], sizesRef.current[1]];
        let innerRaf = 0;
        const outerRaf = requestAnimationFrame(() => {
            innerRaf = requestAnimationFrame(() => setGrow(target));
        });
        const done = window.setTimeout(() => finish(true), SPLIT_INTRO_MS);
        cancelIntroRef.current = () => {
            cancelAnimationFrame(outerRaf);
            cancelAnimationFrame(innerRaf);
            window.clearTimeout(done);
            finish(false);
        };

        return () => {
            cancelAnimationFrame(outerRaf);
            cancelAnimationFrame(innerRaf);
            window.clearTimeout(done);
            cancelIntroRef.current = null;
            if (!finished) {
                endPaneSplitIntro(introHoldRef.current);
                introHoldRef.current = null;
                if (layoutHasSplitNode(connectionId, splitId)) {
                    markSplitIntro(splitId, taken.incomingIndex);
                }
            }
        };
    }, [connectionId, splitId]);

    const stopIntro = useCallback(() => {
        cancelIntroRef.current?.();
    }, []);

    const flushDragRatio = useCallback((ratio: number) => {
        const next = normalizeSizes([ratio, 1 - ratio])[0];
        dragRatioRef.current = next;
        if (dragRafRef.current) return;
        dragRafRef.current = window.requestAnimationFrame(() => {
            dragRafRef.current = 0;
            if (dragRatioRef.current != null) {
                setDragRatio(dragRatioRef.current);
            }
        });
    }, []);

    const commitDrag = useCallback(() => {
        if (dragRafRef.current) {
            window.cancelAnimationFrame(dragRafRef.current);
            dragRafRef.current = 0;
        }
        const ratio = dragRatioRef.current;
        dragRatioRef.current = null;
        setDragRatio(null);
        if (ratio != null) {
            onDrag(ratio);
        }
        onDragEnd();
    }, [onDrag, onDragEnd]);

    const commitKeyResize = useCallback(() => {
        if (dragRafRef.current) {
            window.cancelAnimationFrame(dragRafRef.current);
            dragRafRef.current = 0;
        }
        const ratio = dragRatioRef.current;
        dragRatioRef.current = null;
        setDragRatio(null);
        if (prefersSplitIntroMotion()) setSettle(true);
        if (ratio != null) {
            onDrag(ratio);
        }
        onDragEnd();
    }, [onDrag, onDragEnd]);

    useEffect(() => () => {
        if (dragRafRef.current) {
            window.cancelAnimationFrame(dragRafRef.current);
            dragRafRef.current = 0;
        }
    }, []);

    useEffect(() => {
        if (!settle) return undefined;
        const timer = window.setTimeout(() => setSettle(false), SPLIT_SETTLE_MS);
        return () => window.clearTimeout(timer);
    }, [settle]);

    const liveGrow: [number, number] = dragRatio != null
        ? [dragRatio, 1 - dragRatio]
        : intro
            ? grow
            : sizes;
    const stacked = direction === 'vertical';
    const dragging = dragRatio != null;

    return (
        <div
            data-pane-split=""
            className={cn('relative flex h-full w-full min-h-0 min-w-0', stacked ? 'flex-col' : 'flex-row')}
        >
            <SplitBranch
                grow={liveGrow[0]}
                intro={Boolean(intro)}
                incoming={intro?.incomingIndex === 0}
                dragging={dragging}
                settle={settle}
            >
                {first}
            </SplitBranch>
            <SplitBranch
                grow={liveGrow[1]}
                intro={Boolean(intro)}
                incoming={intro?.incomingIndex === 1}
                dragging={dragging}
                settle={settle}
            >
                {second}
            </SplitBranch>
            <PaneDivider
                direction={direction}
                firstRatio={liveGrow[0] / ((liveGrow[0] + liveGrow[1]) || 1)}
                onDragStart={stopIntro}
                onDrag={(ratio) => {
                    stopIntro();
                    flushDragRatio(ratio);
                }}
                onDragEnd={commitDrag}
                onKeyCommit={commitKeyResize}
                onEqualize={() => {
                    stopIntro();
                    dragRatioRef.current = null;
                    setDragRatio(null);
                    if (prefersSplitIntroMotion()) setSettle(true);
                    onEqualize();
                }}
            />
        </div>
    );
}

export function PaneLayoutView({
    connectionId,
    layout,
    registerSlot,
}: {
    connectionId: string;
    layout: PaneLayout;
    registerSlot: (key: string, node: HTMLDivElement | null) => void;
}) {
    const resizePanes = useAppStore(state => state.resizePanes);

    const onDrag = useCallback((splitId: string, firstRatio: number) => {
        resizePanes(connectionId, splitId, [firstRatio, 1 - firstRatio], false);
    }, [connectionId, resizePanes]);

    const onDragEnd = useCallback((splitId: string) => {
        const groups = useAppStore.getState().paneLayouts[connectionId];
        const current = Object.values(groups ?? {}).find((group) => findNode(group.root, splitId));
        const node = current ? findNode(current.root, splitId) : null;
        if (node && isPaneSplit(node)) {
            resizePanes(connectionId, splitId, node.sizes, true);
        }
    }, [connectionId, resizePanes]);

    const onEqualize = useCallback((splitId: string) => {
        resizePanes(connectionId, splitId, [0.5, 0.5], true);
        window.dispatchEvent(new Event('zync:pane-resize-end'));
    }, [connectionId, resizePanes]);

    const renderNode = (node: PaneNode): ReactNode => {
        if (isPaneLeaf(node)) {
            const key = paneSurfaceKey(node);
            return (
                <div
                    key={node.id}
                    ref={element => registerSlot(key, element)}
                    data-pane-slot={node.id}
                    className="h-full w-full min-h-0 min-w-0"
                />
            );
        }

        return (
            <SplitFrame
                key={node.id}
                connectionId={connectionId}
                splitId={node.id}
                direction={node.direction}
                sizes={node.sizes}
                first={renderNode(node.children[0])}
                second={renderNode(node.children[1])}
                onDrag={(ratio) => onDrag(node.id, ratio)}
                onDragEnd={() => onDragEnd(node.id)}
                onEqualize={() => onEqualize(node.id)}
            />
        );
    };

    return <div className="absolute inset-0">{renderNode(layout.root)}</div>;
}
