import { Listeners } from '@prism/shared';
import { useSyncExternalStore } from 'react';

/** What the window says while the catalog is being upgraded. */
export const UPGRADING_LABEL = 'Updating the catalog…';

/** Whether the catalog is being upgraded as a folder opens, as the main process last told. */
let upgrading = false;
const listeners = new Listeners();
let stopListening: (() => void) | undefined;

function setUpgrading(next: boolean) {
  upgrading = next;
  listeners.tell();
}

function subscribe(listener: () => void) {
  // The window listens to the main process while anything shows it: the loading screen at
  // launch, then the browser for as long as the window is open.
  stopListening ??= globalThis.app.photos.onUpgrading(setUpgrading);
  const remove = listeners.add(listener);
  return () => {
    remove();
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = undefined;
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
