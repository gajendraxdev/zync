/** Copy text via Tauri clipboard plugin with browser fallback. */
export async function writeTerminalClipboardText(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
  } catch (error) {
    console.error('Tauri copy failed, falling back to navigator:', error);
    await navigator.clipboard.writeText(text);
  }
}

/** Read clipboard text via Tauri with browser fallback. */
export async function readTerminalClipboardText(): Promise<string | null> {
  try {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
    const text = await readText();
    return text || null;
  } catch (error) {
    console.error('Tauri paste failed, falling back to navigator:', error);
    try {
      const text = await navigator.clipboard.readText();
      return text || null;
    } catch (fallbackError) {
      console.error('Fallback paste failed:', fallbackError);
      return null;
    }
  }
}