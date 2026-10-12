export interface DragPoint { x: number; y: number }

/** An adapter owns targets/actions; the controller owns the pointer and cleanup. */
export interface TabDragSession {
    isValid: () => boolean;
    /** False refuses the gesture: dispose still runs, but cancel does not. */
    start: (point: DragPoint) => boolean | void;
    /** Return true only while automatic scrolling needs another frame. */
    move: (point: DragPoint) => boolean | void;
    /** Read final geometry now; the returned action runs after chrome cleanup. */
    resolveDrop: (point: DragPoint) => (() => boolean) | null;
    cancel: () => void;
    dispose: () => void;
}

export interface TabDragStart {
    button: number;
    isPrimary: boolean;
    pointerId: number;
    clientX: number;
    clientY: number;
    target: EventTarget | null;
    currentTarget: EventTarget & Element;
}
