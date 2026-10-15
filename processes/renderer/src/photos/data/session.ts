import { PhotoLibrary } from '#photos/data/library';
import { redirect } from 'react-router';

let library: PhotoLibrary | null = null;

export function requireLibrary() {
  if (!library) {
    throw redirect('/');
  }
  return library;
}

export async function openLibrary() {
  const root = await globalThis.app.photos.openFolder();
  if (!root) {
    return false;
  }
  library?.dispose();
  library = new PhotoLibrary(root, globalThis.app.photos);
  return true;
}
