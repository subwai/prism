import { Listeners, type UpdateNotice } from '@prism/shared';
import { useSyncExternalStore } from 'react';

/** Long enough to read the longest notice, which is the reason a check failed. */
const SHOWN_FOR = 5000;

let current: UpdateNotice | null = null;
let hiding: ReturnType<typeof setTimeout> | undefined;
const listeners = new Listeners();

function show(notice: UpdateNotice | null) {
  current = notice;
  listeners.tell();
}

/** Shows `notice`, and hides it again after `SHOWN_FOR`. */
function showForAWhile(notice: UpdateNotice) {
  clearTimeout(hiding);
  hiding = setTimeout(() => show(null), SHOWN_FOR);
  show(notice);
}

let stopListening: (() => void) | undefined;

function subscribe(listener: () => void) {
  // The window listens to the main process while anything shows the notice, which the browser
  // does for as long as the window is open.
  stopListening ??= globalThis.app.updates.onNotice(showForAWhile);
  const remove = listeners.add(listener);
  return () => {
    remove();
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = undefined;
    }
  };
}

/** What the last check for updates the user asked for found, for a few seconds after. */
export function useUpdateNotice(): UpdateNotice | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** Whether an update has downloaded and waits for a restart, until the user puts it off. */
let ready = false;
const readyListeners = new Listeners();

function setReady(next: boolean) {
  ready = next;
  readyListeners.tell();
}

let stopListeningForReady: (() => void) | undefined;
/** Put off until the next launch; the menu still offers to restart meanwhile. */
let putOff = false;

function subscribeReady(listener: () => void) {
  stopListeningForReady ??= globalThis.app.updates.onReady(() => setReady(!putOff));
  const remove = readyListeners.add(listener);
  return () => {
    remove();
    if (readyListeners.size === 0) {
      stopListeningForReady?.();
      stopListeningForReady = undefined;
    }
  };
}

/** Hides the offer to restart into the downloaded update until the next launch. */
export function putOffUpdate(): void {
  putOff = true;
  setReady(false);
}

/** Whether a downloaded update waits for the user to restart into it. */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribeReady, () => ready);
}
