import { useCallback, useState } from 'react';
import { clampSidebarWidth } from '../layout/sidebar/useSidebarResize.js';

export const AI_SIDEBAR_WIDTH_LIMITS = { minWidth: 250, maxWidth: 800, defaultWidth: 300 };
const STORAGE_KEY = 'zync-ai-sidebar-width';

export const clampAiSidebarWidth = (width: number) => clampSidebarWidth(width, AI_SIDEBAR_WIDTH_LIMITS);

/** AI owns persistence only; SidebarChrome owns all geometry and interaction. */
export function useAiSidebarWidth() {
    const [width, setWidth] = useState(() => {
        try {
            return clampAiSidebarWidth(Number.parseInt(localStorage.getItem(STORAGE_KEY) || '300', 10));
        } catch { return AI_SIDEBAR_WIDTH_LIMITS.defaultWidth; }
    });
    const saveWidth = useCallback((value: number) => {
        const next = clampAiSidebarWidth(value);
        setWidth(next);
        try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* Resizing works without storage. */ }
    }, []);
    return { width, saveWidth };
}
