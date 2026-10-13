import type { DragPoint } from './types';

export interface TabReorderTarget { element: HTMLElement; after: boolean }

/** Presentation chooses the axis; identity, pinning and resource ownership do not change. */
function verticalStrip(source: Element): boolean {
    return source.closest('[data-tab-drag-strip]')?.getAttribute('data-tab-drag-axis') === 'vertical';
}

export function isOverTabStrip(source: Element, { x, y }: DragPoint): boolean {
    const strip = source.closest('[data-tab-drag-strip]');
    return !!strip && isPointOverTabStrip(strip, { x, y });
}

export function isPointOverTabStrip(strip: Element, { x, y }: DragPoint): boolean {
    const bounds = strip.getBoundingClientRect();
    return bounds.right > bounds.left && bounds.bottom > bounds.top
        && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

/** Pane insertion includes trailing open-tab chrome; ordinary tab reordering keeps its scroll viewport. */
export function isOverTabInsertionSurface(strip: Element, point: DragPoint): boolean {
    return isPointOverTabStrip(strip.closest('[data-tab-insertion-surface]') ?? strip, point);
}

/** Stable slots own hits across the strip's full height, including its padding.
 * Reorder moves to the hovered slot; insertion chooses its near/far edge for pane docking.
 * Animated children and other strips cannot select a target.
 */
export function tabReorderTarget(source: Element, point: DragPoint, placement: 'insertion' | 'reorder' = 'insertion'): TabReorderTarget | null {
    const strip = source.closest('[data-tab-drag-strip]');
    if (!source.isConnected || !strip || !isOverTabStrip(source, point)) return null;
    return targetInStrip(strip, point, placement, source);
}

/** Header drags insert a new tab rather than reorder an existing slot. Store preflight owns pin policy. */
export function tabInsertionTarget(strip: HTMLElement, point: DragPoint): TabReorderTarget | null {
    if (!strip.isConnected || !isOverTabInsertionSurface(strip, point)) return null;
    if (!isPointOverTabStrip(strip, point)) {
        // The trailing zone always appends, even when the final slot is scrolled out of view.
        const elements = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-drag-item]'))
            .filter(element => element.closest('[data-tab-drag-strip]') === strip);
        const element = elements[elements.length - 1];
        return element ? { element, after: true } : null;
    }
    return targetInStrip(strip, point, 'insertion');
}

function targetInStrip(strip: Element, point: DragPoint, placement: 'insertion' | 'reorder', source?: Element): TabReorderTarget | null {
    let nearest: { element: HTMLElement; rect: DOMRect; distance: number } | null = null;
    const vertical = strip.getAttribute('data-tab-drag-axis') === 'vertical';
    const coordinate = vertical ? point.y : point.x;
    const elements = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-drag-item]'))
        .filter(element => element.closest('[data-tab-drag-strip]') === strip);
    for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.bottom <= rect.top) continue;
        const start = vertical ? rect.top : rect.left;
        const end = vertical ? rect.bottom : rect.right;
        const distance = placement === 'reorder'
            ? Math.abs(coordinate - (start + end) / 2)
            : Math.max(start - coordinate, coordinate - end, 0);
        if (!nearest || distance < nearest.distance) nearest = { element, rect, distance };
    }
    if (!nearest || nearest.element === source || (source && source.getAttribute('data-tab-drag-pinned') !== nearest.element.getAttribute('data-tab-drag-pinned'))) return null;
    const from = elements.indexOf(source as HTMLElement);
    if (placement === 'reorder' && from < 0) return null;
    return { element: nearest.element, after: placement === 'reorder'
        ? elements.indexOf(nearest.element) > from
        : coordinate >= (vertical ? nearest.rect.top + nearest.rect.height / 2 : nearest.rect.left + nearest.rect.width / 2) };
}

/** Transient, theme-colored insertion marker. Never reparents tab chrome or retained pane content. */
export function createTabInsertionFeedback(strip: HTMLElement) {
    const marker = strip.ownerDocument.createElement('div');
    marker.className = 'fixed pointer-events-none z-[9999] rounded-full bg-app-accent';
    marker.setAttribute('aria-hidden', 'true');
    marker.setAttribute('data-pane-tab-insertion', '');
    marker.hidden = true;
    strip.ownerDocument.body.appendChild(marker);
    return {
        update(target: TabReorderTarget | null) {
            marker.hidden = !target;
            if (!target) return;
            const rect = target.element.getBoundingClientRect();
            const bounds = strip.getBoundingClientRect();
            const vertical = strip.getAttribute('data-tab-drag-axis') === 'vertical';
            Object.assign(marker.style, vertical
                ? { left: `${bounds.left}px`, top: `${Math.max(bounds.top, Math.min(bounds.bottom, target.after ? rect.bottom : rect.top)) - 1}px`, width: `${bounds.width}px`, height: '2px' }
                : { left: `${Math.max(bounds.left, Math.min(bounds.right, target.after ? rect.right : rect.left)) - 1}px`, top: `${bounds.top + 2}px`, width: '2px', height: `${Math.max(0, bounds.height - 4)}px` });
        },
        dispose: () => marker.remove(),
    };
}

export function reorderIndex(from: number, target: number, after: boolean): number {
    return target + (after ? 1 : 0) - (from < target ? 1 : 0);
}

/** Animate tab chrome only. Fixed outer slots keep hit testing free of feedback loops. */
export function createTabReorderFeedback(source: Element) {
    const elements = Array.from(source.parentElement?.querySelectorAll<HTMLElement>(':scope > [data-tab-drag-item]') ?? []);
    const from = elements.indexOf(source as HTMLElement);
    if (from < 0) return null;
    const visuals = elements.map(element => element.querySelector<HTMLElement>('[data-tab-drag-visual]'));
    const vertical = verticalStrip(source);
    const reset = () => visuals.forEach(visual => visual?.style.removeProperty('transform'));
    return {
        update(target: TabReorderTarget | null) {
            const index = elements.indexOf(target?.element as HTMLElement);
            if (!target || index < 0 || elements.some(element => !element.isConnected)) { reset(); return; }
            const bounds = elements.map(element => element.getBoundingClientRect());
            const gap = bounds.length > 1 ? (vertical ? bounds[1].top - bounds[0].bottom : bounds[1].left - bounds[0].right) : 0;
            const order = elements.map((_, position) => position);
            order.splice(from, 1);
            order.splice(reorderIndex(from, index, target.after), 0, from);
            let offset = vertical ? bounds[0].top : bounds[0].left;
            for (const position of order) {
                const visual = visuals[position];
                if (visual && position !== from) visual.style.transform = vertical
                    ? `translateY(${offset - bounds[position].top}px)` : `translateX(${offset - bounds[position].left}px)`;
                offset += (vertical ? bounds[position].height : bounds[position].width) + gap;
            }
        },
        dispose() {
            // Finish at the new DOM slots, not mid-transition at their old offsets.
            // Flush once before React applies the final order; retained hosts are untouched.
            for (const visual of visuals) {
                if (!visual) continue;
                visual.style.transition = 'none';
                visual.style.removeProperty('transform');
            }
            elements[0]?.getBoundingClientRect();
            for (const visual of visuals) visual?.style.removeProperty('transition');
        },
    };
}

/** Continue frames only while a stationary pointer at the strip edge can scroll it. */
export function scrollTabStrip(source: Element, point: DragPoint): boolean {
    const strip = source.closest<HTMLElement>('[data-tab-drag-strip]');
    const vertical = verticalStrip(source);
    if (!strip || !isOverTabStrip(source, point) || (vertical ? strip.scrollHeight <= strip.clientHeight : strip.scrollWidth <= strip.clientWidth)) return false;
    const rect = strip.getBoundingClientRect();
    const edge = Math.min(32, (vertical ? rect.height : rect.width) / 4);
    const coordinate = vertical ? point.y : point.x;
    const direction = coordinate < (vertical ? rect.top : rect.left) + edge ? -1 : coordinate > (vertical ? rect.bottom : rect.right) - edge ? 1 : 0;
    const before = vertical ? strip.scrollTop : strip.scrollLeft;
    if (vertical) strip.scrollTop += direction * 8;
    else strip.scrollLeft += direction * 8;
    return (vertical ? strip.scrollTop : strip.scrollLeft) !== before;
}
