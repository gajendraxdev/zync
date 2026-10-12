import type { DragPoint } from './types';

/** Copy the dedicated inert preview only; resource hosts and live controls stay put. */
export function createTabDragPreview(target: Element, origin: DragPoint) {
    const source = target.closest<HTMLElement>('[data-tab-drag-source]');
    const template = source?.querySelector<HTMLElement>('[data-tab-drag-preview]');
    if (!source || !template) return null;
    const preview = source.ownerDocument.createElement('div');
    preview.className = 'tab-drag-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    preview.appendChild(template.cloneNode(true));
    const bounds = source.getBoundingClientRect();
    const width = Math.min(bounds.width, 240);
    preview.style.width = `${width}px`;
    const offset = { x: Math.min(Math.max(0, origin.x - bounds.left), width), y: Math.min(Math.max(0, origin.y - bounds.top), 32) };
    const move = ({ x, y }: DragPoint) => { preview.style.transform = `translate3d(${x - offset.x}px, ${y - offset.y}px, 0)`; };
    move(origin);
    source.ownerDocument.body.appendChild(preview);
    source.setAttribute('data-tab-dragging', 'true');
    return { move, dispose: () => { source.removeAttribute('data-tab-dragging'); preview.remove(); } };
}
