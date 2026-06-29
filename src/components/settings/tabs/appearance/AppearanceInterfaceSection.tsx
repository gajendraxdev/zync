import type { AppSettings } from '../../../../store/settingsSlice';
import { Section } from '../../common/Section';
import { Toggle } from '../../common/Toggle';

export interface AppearanceInterfaceSectionProps {
    compactMode: AppSettings['compactMode'];
    onCompactModeChange: (enabled: boolean) => void;
}

export function AppearanceInterfaceSection({
    compactMode,
    onCompactModeChange,
}: AppearanceInterfaceSectionProps) {
    return (
        <Section title="Interface">
            <div className="space-y-2 rounded-lg border border-[var(--color-app-border)]/50 bg-[var(--color-app-surface)]/50 p-1">
                <Toggle
                    label="Compact Mode"
                    description="Reduce spacing for denser UI."
                    checked={compactMode}
                    onChange={onCompactModeChange}
                />
            </div>
        </Section>
    );
}