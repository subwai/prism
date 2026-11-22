import type { LibrarySession } from '#data/library';
import { type PendingEdits, shownEntry } from '#data/pending-edits';
import type { KnownFolders } from '#data/trails';
import { buildCachedThumbnailURL, type PhotoEntry, type ThumbnailResult } from '@prism/shared';
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
  return buildCachedThumbnailURL(library.root.session, entry, generation);
}

/**
 * What the worker told of the entry's thumbnail since it was on show or this read it, which a
 * tile shows once its cached one is missing: `undefined` until it has.
 */
export function useToldThumbnail(entryId: string): ThumbnailResult | undefined {
  const { media } = useLibrary();
  return useSyncExternalStore(
    (listener) => media.subscribeThumbnail(entryId, listener),
    () => media.thumbnail(entryId),
  );
}

/** The library's pending edits, which every place showing an entry lays over it. */
export function usePendingEdits(): PendingEdits {
  const { edits } = useLibrary();
  return useSyncExternalStore(edits.subscribe, edits.getSnapshot);
}

/**
 * The library's folders as the window knows them, for `trailIn` and `folderIn`: the catalog's
 * tree, read again as the worker tells of changes, and the edits made here.
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
