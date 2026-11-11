import { isBoolean, storedPreferences } from '#data/stored-preferences';
import { useSyncExternalStore } from 'react';

/** How photos and videos show in every viewer. */
export interface ViewerPreferences {
  /**
   * Photos fit the window, or show at actual size. Zooming a photo leaves fit too, so it holds
   * only while the window is open, and each launch starts with photos fitted.
   */
  fit: boolean;
  /** Kept across reloads and launches. */
  muted: boolean;
}

const store = storedPreferences<ViewerPreferences>(
  'viewer-preferences',
  { fit: true, muted: false },
  { fit: () => false, muted: isBoolean },
);

export function setViewerPreferences(changes: Partial<ViewerPreferences>) {
  store.set(changes);
}

export function useViewerPreferences() {
  return useSyncExternalStore(store.subscribe, store.current, () => store.defaults);
}
