import { createLibrary, type PhotoLibrary } from '#data/library';
import { replace } from 'react-router';

let library: PhotoLibrary | null = null;
let restoring: Promise<unknown> | null = null;

export function requireLibrary() {
  if (!library) {
    throw replace('/');
  }
  return library;
}

/** Reopens the previous session's folder once per page load, so reloads keep their place. */
export async function restoreLibrary() {
  restoring ??= globalThis.app.photos
    .restoreFolder()
    .then((root) => {
      if (root && !library) {
        library = createLibrary(root, globalThis.app.photos);
      }
    })
    .catch(() => null);
  await restoring;
  return library !== null;
}

export async function loadLibrary() {
  await restoreLibrary();
  return requireLibrary();
}

export async function openLibrary() {
  const root = await globalThis.app.photos.openFolder();
  if (!root) {
    return false;
  }
  library?.close();
  library = createLibrary(root, globalThis.app.photos);
  return true;
}
