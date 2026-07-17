import { AlertCircle, Settings } from 'lucide-react';
import { friendlyAiError } from './aiSetupErrors';
import type { ProviderValue } from './providerCatalog';
import { useAppStore } from '../../store/useAppStore';

interface AiSetupErrorCardProps {
    message: string;
    provider?: ProviderValue;
    className?: string;
}

/**
 * Chat-inline setup / auth error with optional one-click open to Settings → AI.
 */
export function AiSetupErrorCard({ message, provider, className }: AiSetupErrorCardProps) {
    const openSettings = useAppStore((s) => s.openSettings);
    const settingsProvider = useAppStore((s) => s.settings.ai?.provider) as ProviderValue | undefined;
    const resolvedProvider = provider ?? settingsProvider;
    const { text, showSettingsCta } = friendlyAiError(message, resolvedProvider);

    return (
        <div
            className={
                className
                ?? 'flex flex-col gap-2 p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/20 text-amber-100/90'
            }
        >
            <div className="flex items-start gap-2">
                <AlertCircle size={12} className="shrink-0 mt-0.5 text-amber-400" />
                <p className="text-[11px] leading-relaxed text-amber-100/90">{text}</p>
            </div>
            {showSettingsCta && (
                <button
                    type="button"
                    onClick={() => openSettings('ai')}
                    className="self-start ml-5 inline-flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20 hover:text-amber-100 transition-colors"
                >
                    <Settings size={11} />
                    Open Settings → AI
                </button>
            )}
        </div>
    );
}
