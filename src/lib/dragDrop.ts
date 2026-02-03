// Global drag state (shared across all FileGrid instances)
// This is moved here to avoid HMR issues when FileGrid.tsx reloads
let currentDragSource: { connectionId: string; path: string } | null = null;

export function getCurrentDragSource() {
    return currentDragSource;
}

export function setCurrentDragSource(source: { connectionId: string; path: string } | null) {
    currentDragSource = source;
}
