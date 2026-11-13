import type { AppAPI, UpdateNotice } from '@prism/shared';
import { vi } from 'vitest';

const noticeListeners = new Set<(notice: UpdateNotice) => void>();
const readyListeners = new Set<() => void>();

/** Tells the window what a check for updates found, as the main process does. */
export function sendUpdateNotice(notice: UpdateNotice) {
  for (const listener of noticeListeners) {
    listener(notice);
  }
}

/** Tells the window an update has downloaded, as the main process does. */
export function sendUpdateReady() {
  for (const listener of readyListeners) {
    listener();
  }
}

/** Calls to restart into the downloaded update, which the tests check. */
export const installUpdate = vi.fn(() => Promise.resolve());

/** The updater as the preload script gives it the window, told what to say by the tests. */
export function fakeUpdates(): AppAPI['updates'] {
  return {
    install: installUpdate,
    onNotice: (listener) => {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
    onReady: (listener) => {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
  };
}
