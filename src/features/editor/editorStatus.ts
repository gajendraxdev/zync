import { useSyncExternalStore } from 'react';

type EditorStatusSource = symbol;

let activeSource: EditorStatusSource | null = null;
let currentStatus = '';
const listeners = new Set<() => void>();

function emitStatusChange() {
  listeners.forEach((listener) => listener());
}

export function createEditorStatusSource(label: string): EditorStatusSource {
  return Symbol(label);
}

export function publishEditorStatus(source: EditorStatusSource, status: string) {
  if (activeSource === source && currentStatus === status) return;

  activeSource = source;
  currentStatus = status;
  emitStatusChange();
}

export function clearEditorStatus(source: EditorStatusSource) {
  if (activeSource !== source) return;

  activeSource = null;
  currentStatus = '';
  emitStatusChange();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentStatus;
}

export function useEditorStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
