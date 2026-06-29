import type { FontWeight } from '@xterm/xterm';

export const DEFAULT_GLOBAL_FONT_STACK =
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Ubuntu, Cantarell, Arial, sans-serif";
export const DEFAULT_GLOBAL_FONT_SIZE = 14;

export const DEFAULT_TERMINAL_FONT_STACK =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
export const DEFAULT_TERMINAL_FONT_STACK_WIN32 =
    "Consolas, 'Cascadia Mono', 'Cascadia Code', ui-monospace, monospace";
export const DEFAULT_TERMINAL_FONT_SIZE = 14;
export const DEFAULT_TERMINAL_FONT_SIZE_WIN32 = 15;
export const DEFAULT_TERMINAL_FONT_WEIGHT = 'normal' satisfies FontWeight;
export const DEFAULT_TERMINAL_FONT_WEIGHT_WIN32 = 500 satisfies FontWeight;
export const DEFAULT_TERMINAL_FONT_WEIGHT_BOLD = 'bold' satisfies FontWeight;
export const DEFAULT_TERMINAL_PADDING = 12;
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.2;
export const DEFAULT_TERMINAL_LIGATURES = false;
export const DEFAULT_TERMINAL_GPU_ACCELERATION = true;

export type TerminalFontWeightSetting = 'normal' | 500 | 600 | 700;

export const TERMINAL_FONT_WEIGHT_OPTIONS: ReadonlyArray<{
    value: TerminalFontWeightSetting;
    label: string;
    description: string;
}> = [
    { value: 'normal', label: 'Regular (400)', description: 'Default xterm weight' },
    { value: 500, label: 'Medium (500)', description: 'Recommended on Windows for thin monospace fonts' },
    { value: 600, label: 'Semi-bold (600)', description: 'Heavier strokes for high-DPI displays' },
    { value: 700, label: 'Bold (700)', description: 'Maximum weight for regular text' },
];

function isWindowsPlatform(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    const platform = window.electronUtils?.platform;
    if (platform === 'win32') {
        return true;
    }
    return typeof navigator !== 'undefined' && /win/i.test(navigator.platform);
}

export function resolveDefaultTerminalTypography(): {
    fontFamily: string;
    fontSize: number;
    fontWeight: TerminalFontWeightSetting;
} {
    if (isWindowsPlatform()) {
        return {
            fontFamily: DEFAULT_TERMINAL_FONT_STACK_WIN32,
            fontSize: DEFAULT_TERMINAL_FONT_SIZE_WIN32,
            fontWeight: DEFAULT_TERMINAL_FONT_WEIGHT_WIN32,
        };
    }

    return {
        fontFamily: DEFAULT_TERMINAL_FONT_STACK,
        fontSize: DEFAULT_TERMINAL_FONT_SIZE,
        fontWeight: DEFAULT_TERMINAL_FONT_WEIGHT,
    };
}
export {
    DEFAULT_SUSPEND_IDLE_HOST_PTYS,
    DEFAULT_IDLE_HOST_PTY_SUSPEND_MINUTES,
} from '../../../lib/terminal/terminalIdlePty.js';
