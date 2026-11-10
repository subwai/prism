import { COVER_SIZE, PAGE_WIDTH, THUMBNAIL_SIZE } from '#data/entries';
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

/**
 * Kept in local storage, which Chromium saves in the app's profile and reads back at once, so a
 * view's first frame already has its sizes; a file would need a round trip to the main process.
 */
const STORAGE_KEY = 'layout-preferences';

const DEFAULTS: LayoutPreferences = {
  coverSize: COVER_SIZE.default,
  filmstripSize: THUMBNAIL_SIZE.filmstrip,
  pageWidth: PAGE_WIDTH,
  sidebarWidth: undefined,
  thumbnailSize: THUMBNAIL_SIZE.grid,
};

let preferences: LayoutPreferences | undefined;
const listeners = new Set<() => void>();

/** What was saved, each size the default where it is missing or not a number. */
function read(): LayoutPreferences {
  let saved: Partial<Record<keyof LayoutPreferences, unknown>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    // Unreadable, it starts over from the defaults.
  }
  const loaded = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof LayoutPreferences)[]) {
    const value = saved[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      loaded[key] = value;
    }
  }
  return loaded;
}

function current() {
  preferences ??= read();
  return preferences;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLayoutPreference<Key extends keyof LayoutPreferences>(
  key: Key,
  value: LayoutPreferences[Key],
) {
  preferences = { ...current(), [key]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Unsaved, it still holds for as long as the window is open.
  }
  for (const listener of listeners) {
    listener();
  }
}

/** One of the layout's sizes, and a function that sets and saves it. */
export function useLayoutPreference<Key extends keyof LayoutPreferences>(key: Key) {
  const value = useSyncExternalStore(
    subscribe,
    () => current()[key],
    // The build renders the shell without local storage.
    () => DEFAULTS[key],
  );
  return [value, (next: LayoutPreferences[Key]) => setLayoutPreference(key, next)] as const;
}
