import { isBoolean, storedPreferences } from '#data/stored-preferences';
import { useSyncExternalStore } from 'react';

/** How photos and videos show in every viewer. */
export interface ViewerPreferences {
  /**
   * Photos fit the window, or show at actual size. Zooming a photo leaves fit too, so it holds
   * only while the window is open, and each launch starts with photos fitted.
   */
  fit: boolean;
  /** Kept across reloads and launches, as is the volume. */
  muted: boolean;
  /** From 0 to 1, which muting leaves as it was, to come back to. */
  volume: number;
}

const store = storedPreferences<ViewerPreferences>(
  'viewer-preferences',
  { fit: true, muted: false, volume: 1 },
  {
    fit: () => false,
    muted: isBoolean,
    volume: (value) => typeof value === 'number' && value >= 0 && value <= 1,
  },
);

export function setViewerPreferences(changes: Partial<ViewerPreferences>) {
  store.set(changes);
}

/** Whether videos play silently: muted, or turned all the way down. */
export function isSilent({ muted, volume }: ViewerPreferences) {
  return muted || volume === 0;
}

/**
 * Mutes, or unmutes what is silent. A video turned all the way down comes back at full volume,
 * as unmuting it otherwise would leave it silent.
 */
export function toggleMuted() {
  const preferences = store.current();
  setViewerPreferences(
    isSilent(preferences) ? { muted: false, volume: preferences.volume || 1 } : { muted: true },
  );
}

/**
 * Keeps `video` at the volume set, until the returned function is called. A video's volume is a
 * property with no attribute to render, so it is set on the element.
 */
export function followVolume(video: HTMLVideoElement) {
  const apply = () => {
    video.volume = store.current().volume;
  };
  apply();
  return store.subscribe(apply);
}

export function useViewerPreferences() {
  return useSyncExternalStore(store.subscribe, store.current, () => store.defaults);
}
