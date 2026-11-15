import { useSyncExternalStore } from 'react';

/** What the window says while the catalog is being upgraded. */
export const UPGRADING_LABEL = 'Updating the catalog…';

/** Whether the catalog is being upgraded as a folder opens, as the main process last told. */
let upgrading = false;
const listeners = new Set<() => void>();
let stopHearing: (() => void) | undefined;

function hear(next: boolean) {
  upgrading = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  // The window listens to the main process while anything shows it: the loading screen at
  // launch, then the browser for as long as the window is open.
  stopHearing ??= globalThis.app.photos.onUpgrading(hear);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopHearing?.();
      stopHearing = undefined;
    }
  };
}

/**
 * Whether the catalog is being upgraded, which on a large one takes a minute or so. The build
 * prerenders the loading screen, before any folder opens.
 */
export function useCatalogUpgrading(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => upgrading,
    () => false,
  );
}
