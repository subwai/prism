import type { UpdateNotice } from '@prism/shared';
import { useSyncExternalStore } from 'react';

/** Long enough to read the longest notice, which is the reason a check failed. */
const SHOWN_FOR = 5000;

let current: UpdateNotice | null = null;
let hiding: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function show(notice: UpdateNotice | null) {
  current = notice;
  for (const listener of listeners) {
    listener();
  }
}

function hear(notice: UpdateNotice) {
  clearTimeout(hiding);
  hiding = setTimeout(() => show(null), SHOWN_FOR);
  show(notice);
}

let stopHearing: (() => void) | undefined;

function subscribe(listener: () => void) {
  // The window listens to the main process while anything shows the notice, which the browser
  // does for as long as the window is open.
  stopHearing ??= globalThis.app.updates.onNotice(hear);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopHearing?.();
      stopHearing = undefined;
    }
  };
}

/** What the last check for updates the user asked for found, for a few seconds after. */
export function useUpdateNotice(): UpdateNotice | null {
  return useSyncExternalStore(subscribe, () => current);
}
