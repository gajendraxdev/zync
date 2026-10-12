import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readThemeJson, THEME_FILE_MAX_BYTES, writeThemeJson, type ThemeDocument } from '../domain/themeDocument';

export interface ThemeFilePort {
    pick(): Promise<ThemeDocument | null>;
    export(theme: ThemeDocument): Promise<boolean>;
}
export async function readBrowserThemeFile(file: File): Promise<ThemeDocument> {
    if (file.size > THEME_FILE_MAX_BYTES) throw new Error('Theme files must be 64 KB or smaller.');
    return readThemeJson(await file.text());
}

/** Desktop uses the existing user-approved file dialogs and bounded local reader.
 * Browser fixtures use the same validator with a file picker/download, never native storage.
 */
export const themeFiles: ThemeFilePort = {
    async pick() {
        if (isTauri()) {
            const path = await open({ multiple: false, directory: false, filters: [{ name: 'Zync theme JSON', extensions: ['json'] }] });
            if (typeof path !== 'string') return null;
            const text = await invoke<string>('fs_read_file', { connectionId: 'local', path, maxBytes: THEME_FILE_MAX_BYTES });
            return readThemeJson(text);
        }
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.json,application/json';
            input.oncancel = () => resolve(null);
            input.onchange = () => {
                const file = input.files?.[0];
                if (!file) resolve(null);
                else void readBrowserThemeFile(file).then(resolve, reject);
            };
            input.click();
        });
    },
    async export(theme) {
        const content = writeThemeJson(theme);
        if (isTauri()) {
            const path = await save({ defaultPath: 'zync-theme.json', filters: [{ name: 'Zync theme JSON', extensions: ['json'] }] });
            if (!path) return false;
            await invoke('fs_write_file', { connectionId: 'local', path, content });
            return true;
        }
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = 'zync-theme.json';
        document.body.appendChild(link); link.click(); link.remove();
        // Keep the URL alive through the browser's download dispatch.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    },
};
