import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../../../../store/settingsSlice';
import { TerminalTypographySection } from './TerminalTypographySection';
import { TerminalViewportSection } from './TerminalViewportSection';

interface TerminalAppearanceSectionProps {
    settings: AppSettings;
    terminalFontDraft: string;
    setTerminalFontDraft: (value: string) => void;
    isWindows: boolean;
    updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
    updateTerminalSettings: (updates: Partial<AppSettings['terminal']>) => Promise<void>;
}

/** Terminal-only visuals reuse existing keys and commit boundaries; colors stay in Appearance. */
export function TerminalAppearanceSection({ settings, terminalFontDraft, setTerminalFontDraft, isWindows,
    updateSettings, updateTerminalSettings }: TerminalAppearanceSectionProps) {
    const clampedPercent = Math.round(Math.min(1, Math.max(0.3, settings.windowOpacity ?? 1)) * 100);
    const [draftOpacityPercent, setDraftOpacityPercent] = useState(clampedPercent);
    const lastSubmittedOpacityPercentRef = useRef<number | null>(null);
    useEffect(() => {
        setDraftOpacityPercent(clampedPercent);
        if (lastSubmittedOpacityPercentRef.current === clampedPercent) lastSubmittedOpacityPercentRef.current = null;
    }, [clampedPercent]);

    const commitTerminalOpacity = () => {
        const nextPercent = Math.max(30, Math.min(100, Number.parseInt(String(draftOpacityPercent), 10) || 100));
        if (nextPercent === clampedPercent) {
            setDraftOpacityPercent(nextPercent);
            lastSubmittedOpacityPercentRef.current = null;
            return;
        }
        if (nextPercent === lastSubmittedOpacityPercentRef.current) {
            setDraftOpacityPercent(nextPercent);
            return;
        }
        lastSubmittedOpacityPercentRef.current = nextPercent;
        void updateSettings({ windowOpacity: nextPercent / 100 });
    };

    return <>
        <TerminalTypographySection settings={settings} terminalFontDraft={terminalFontDraft} isWindows={isWindows}
            onTerminalFontDraftChange={setTerminalFontDraft}
            onUpdateTerminalSettings={updates => { void updateTerminalSettings(updates); }} />
        <TerminalViewportSection settings={settings} draftOpacityPercent={draftOpacityPercent}
            onDraftOpacityPercentChange={setDraftOpacityPercent} onCommitTerminalOpacity={commitTerminalOpacity}
            onTransparencyChange={enableVibrancy => { void updateSettings({ enableVibrancy }); }}
            onCursorStyleChange={cursorStyle => { void updateTerminalSettings({ cursorStyle }); }} />
    </>;
}
