import type { ProviderValue } from './providerCatalog';
import { getProviderOption } from './providerCatalog';

/** Shared setup-copy for Ollama / model readiness (sidebar + error mapping). */
export const OLLAMA_NOT_RUNNING_MESSAGE =
    'Ollama is not running. Start Ollama, or switch to another provider in Settings → AI.';

export const OLLAMA_NO_MODEL_MESSAGE =
    'No Ollama model found. Pull a model (for example: ollama pull llama3.2) or switch provider in Settings → AI.';

export const NO_MODEL_SELECTED_MESSAGE =
    'No model selected for the current provider. Pick a model, or open Settings → AI.';

export function providerRequiresApiKey(provider: ProviderValue): boolean {
    return provider !== 'ollama';
}

export function formatMissingApiKeyMessage(provider: ProviderValue): string {
    const label = getProviderOption(provider).label;
    return `${label} API key is not set. Add your key in Settings → AI, then try again.`;
}

export interface FriendlyAiError {
    text: string;
    showSettingsCta: boolean;
}

/** Map backend/provider errors into chat-friendly copy + whether to offer Settings navigation. */
export function friendlyAiError(
    message: string,
    provider?: ProviderValue,
): FriendlyAiError {
    const trimmed = (message ?? '').trim();
    if (!trimmed) {
        return { text: 'Something went wrong. Please try again.', showSettingsCta: false };
    }

    if (/API key not configured/i.test(trimmed)) {
        return {
            text: provider
                ? formatMissingApiKeyMessage(provider)
                : 'API key is not set. Add your key in Settings → AI, then try again.',
            showSettingsCta: true,
        };
    }

    if (/Invalid .+ API key/i.test(trimmed)) {
        const label = provider ? getProviderOption(provider).label : 'provider';
        return {
            text: `That ${label} API key was rejected. Update it in Settings → AI and try again.`,
            showSettingsCta: true,
        };
    }

    if (/Ollama not running|ollama serve/i.test(trimmed)) {
        return {
            text: OLLAMA_NOT_RUNNING_MESSAGE,
            showSettingsCta: true,
        };
    }

    if (/Settings\s*->\s*AI|Settings\s*→\s*AI/i.test(trimmed)) {
        return { text: trimmed.replace(/Settings\s*->\s*AI/gi, 'Settings → AI'), showSettingsCta: true };
    }

    return { text: trimmed, showSettingsCta: false };
}
