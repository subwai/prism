import { useSyncExternalStore } from 'react';

/** How photos and videos show, for as long as the window is open, in every viewer. */
export interface ViewerPreferences {
  /** Photos fit the window, or show at actual size. */
  fit: boolean;
  muted: boolean;
}

let preferences: ViewerPreferences = { fit: true, muted: false };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setViewerPreferences(changes: Partial<ViewerPreferences>) {
  preferences = { ...preferences, ...changes };
  for (const listener of listeners) {
    listener();
  }
}

export function useViewerPreferences() {
  return useSyncExternalStore(subscribe, () => preferences);
}
