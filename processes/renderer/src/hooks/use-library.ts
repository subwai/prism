import { type PendingEdits, shownEntry } from '#data/edits/pending-edits';
import type { LibrarySession } from '#data/session/library-session';
import type { KnownFolders } from '#data/tree/trails';
import { cachedThumbnailURL, type PhotoEntry, type ThumbnailResult } from '@prism/shared';
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
  const generation = useSyncExternalStore(media.subscribe, media.getGeneration);
  return cachedThumbnailURL(library.root.session, entry, generation);
}

/**
 * The worker's result for the entry's thumbnail, sent since the entry was on screen or this
 * hook read it. A tile shows it when its cached thumbnail is missing. `undefined` until sent.
 */
export function useThumbnailResult(entryId: string): ThumbnailResult | undefined {
  const { media } = useLibrary();
  return useSyncExternalStore(
    (listener) => media.subscribeThumbnail(entryId, listener),
    () => media.thumbnailResult(entryId),
  );
}

/** The library's pending edits, which every place showing an entry lays over it. */
export function usePendingEdits(): PendingEdits {
  const { edits } = useLibrary();
  return useSyncExternalStore(edits.subscribe, edits.getSnapshot);
}

/**
 * The library's folders as the window knows them, for `trailIn` and `folderAt`: the catalog's
 * tree, read again when the worker reports changes, and the edits made in this window.
 */
export function useKnownFolders({ tree, edits }: LibrarySession): KnownFolders {
  return {
    edits: useSyncExternalStore(edits.subscribe, edits.getSnapshot),
    tree: useSyncExternalStore(tree.subscribe, tree.getSnapshot),
  };
}

/** `entry` as the window shows it, with the edits under way and the renames done here. */
export function useShownEntry(entry: PhotoEntry): PhotoEntry {
  return shownEntry(usePendingEdits(), entry);
}
