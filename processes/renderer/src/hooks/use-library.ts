import type { LibrarySession } from '#data/library';
import { cachedThumbnailURL, type PhotoEntry } from '@prism/shared';
import { createContext, useContext, useSyncExternalStore } from 'react';

export const LibraryContext = createContext<LibrarySession | null>(null);
export function useLibrary() {
  const library = useContext(LibraryContext);
  if (!library) {
    throw new Error('A photo library is required');
  }
  return library;
}

/** Where `entry`'s thumbnail is if it is cached, which changes as a refresh reads them again. */
export function useCachedThumbnail(entry: PhotoEntry) {
  const library = useLibrary();
  const { media } = library;
  const generation = useSyncExternalStore(media.subscribeGeneration, media.getGeneration);
  return cachedThumbnailURL(library.root.session, entry, generation);
}
