export function createPluginReloadQueue() {
    let tail: Promise<void> = Promise.resolve();

    return <T>(reload: () => Promise<T>): Promise<T> => {
        const result = tail.then(reload);
        // A failed reload still releases the next request, but keeps its own result.
        tail = result.then(() => undefined, () => undefined);
        return result;
    };
}
