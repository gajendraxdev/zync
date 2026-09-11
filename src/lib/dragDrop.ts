import { useEffect, useState } from 'react';

// Global drag state (shared across all FileGrid instances)
// This is moved here to avoid HMR issues when FileGrid.tsx reloads
let currentDragSource: { connectionId: string; path: string } | null = null;
let currentDragPaths: string[] = [];
const dragListeners = new Set<() => void>();

export function getCurrentDragSource() {
    return currentDragSource;
}

/** Live Files-drag paths only. Empty after dragend so a later drop cannot reuse them. */
export function getCurrentDragPaths(): string[] {
    if (currentDragSource == null) return [];
    return currentDragPaths.slice();
}

export function isInternalFileDrag() {
    return currentDragSource != null;
}

export function subscribeInternalFileDrag(listener: () => void) {
    dragListeners.add(listener);
    return () => {
        dragListeners.delete(listener);
    };
}

function notifyFileDragListeners() {
    dragListeners.forEach((listener) => listener());
}

export function setCurrentDragSource(
    source: { connectionId: string; path: string } | null,
    paths?: string[],
) {
    const wasDragging = currentDragSource != null;
    currentDragSource = source;
    if (source) {
        if (paths && paths.length > 0) {
            currentDragPaths = paths.slice();
        }
    } else {
        currentDragPaths = [];
    }
    const isDragging = source != null;
    if (wasDragging !== isDragging) notifyFileDragListeners();
}

export function useInternalFileDrag(): boolean {
    const [active, setActive] = useState(isInternalFileDrag);
    useEffect(() => subscribeInternalFileDrag(() => setActive(isInternalFileDrag())), []);
    return active;
}

if (typeof window !== 'undefined') {
    window.addEventListener('dragend', () => {
        if (currentDragSource) setCurrentDragSource(null);
    });
}
