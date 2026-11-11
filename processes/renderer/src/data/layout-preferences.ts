import { COVER_SIZE, PAGE_WIDTH, THUMBNAIL_SIZE } from '#data/entries';
import { isNumber, storedPreferences } from '#data/stored-preferences';
import { useSyncExternalStore } from 'react';

/**
 * The sizes set with the sliders and by dragging panes' edges, which stay as set while moving
 * between folders, and across reloads and launches.
 */
export interface LayoutPreferences {
  /** The grid's thumbnail size. */
  thumbnailSize: number;
  /** The filmstrip's thumbnail size, set by dragging its edge. */
  filmstripSize: number;
  /** How wide the reader shows pages. */
  pageWidth: number;
  /** How large the folder tree shows folders' covers. */
  coverSize: number;
  /** How wide the sidebar is; until it is resized, the theme's width. */
  sidebarWidth: number | undefined;
}

const store = storedPreferences<LayoutPreferences>(
  'layout-preferences',
  {
    coverSize: COVER_SIZE.default,
    filmstripSize: THUMBNAIL_SIZE.filmstrip,
    pageWidth: PAGE_WIDTH,
    sidebarWidth: undefined,
    thumbnailSize: THUMBNAIL_SIZE.grid,
  },
  {
    coverSize: isNumber,
    filmstripSize: isNumber,
    pageWidth: isNumber,
    sidebarWidth: isNumber,
    thumbnailSize: isNumber,
  },
);

/** One of the layout's sizes, and a function that sets and saves it. */
export function useLayoutPreference<Key extends keyof LayoutPreferences>(key: Key) {
  const value = useSyncExternalStore(
    store.subscribe,
    () => store.current()[key],
    // The build renders the shell without local storage.
    () => store.defaults[key],
  );
  return [value, (next: LayoutPreferences[Key]) => store.set({ [key]: next })] as const;
}
