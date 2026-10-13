/** Check the popup's rendered box against its viewport and clipping ancestors. */
export function popupIsUnclipped(popup: HTMLElement): boolean {
    const view = popup.ownerDocument.defaultView;
    if (!view) return false;
    const bounds = popup.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.left < -1 || bounds.top < -1
        || bounds.right > view.innerWidth + 1 || bounds.bottom > view.innerHeight + 1) return false;
    for (let ancestor = popup.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = view.getComputedStyle(ancestor);
        const clip = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)
            && (bounds.top < clip.top - 1 || bounds.bottom > clip.bottom + 1)) return false;
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)
            && (bounds.left < clip.left - 1 || bounds.right > clip.right + 1)) return false;
    }
    return true;
}
