import { useEffect, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export function useTauriFileDrop(onDrop: (paths: string[]) => void) {
    const [isDraggingOver, setIsDraggingOver] = useState(false);

    useEffect(() => {
        let unlistenDrop: UnlistenFn;
        let unlistenHover: UnlistenFn;
        let unlistenCancel: UnlistenFn;

        const setupListeners = async () => {
            unlistenDrop = await listen<{ paths: string[] }>('tauri://drop', (event) => {
                setIsDraggingOver(false);
                if (event.payload.paths && event.payload.paths.length > 0) {
                    onDrop(event.payload.paths);
                }
            });

            unlistenHover = await listen('tauri://drag-enter', () => {
                setIsDraggingOver(true);
            });

            unlistenCancel = await listen('tauri://drag-leave', () => {
                setIsDraggingOver(false);
            });
        };

        setupListeners();

        return () => {
            if (unlistenDrop) unlistenDrop();
            if (unlistenHover) unlistenHover();
            if (unlistenCancel) unlistenCancel();
        };
    }, [onDrop]);

    return { isDraggingOver };
}
