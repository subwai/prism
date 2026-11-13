import { listedThumbnailKey, mediaKind } from '@prism/media';

/**
 * The key of the thumbnail a `cachedThumbnailURL` names by its file's listing, so it is found
 * with no call to the folder's worker: each call waited its turn behind whatever the worker and
 * its catalog were reading, a tile at a time. `null` if the URL does not say enough: an entry
 * listed before the catalog kept inodes, or on a disk that reports none, whose thumbnail goes
 * by the file's canonical path, which only the worker knows.
 */
export function listedKeyOf(url: URL, entryId: string): string | null {
  const inode = url.searchParams.get('inode');
  const size = Number(url.searchParams.get('size') ?? Number.NaN);
  const modifiedMs = Number(url.searchParams.get('modified') ?? Number.NaN);
  if (!inode || inode === '0' || !Number.isFinite(size) || !Number.isFinite(modifiedMs)) {
    return null;
  }
  // The path is left out of a key that goes by inode.
  return listedThumbnailKey(
    { file: entryId, inode, modifiedMs, size },
    mediaKind(entryId) === 'video',
  );
}
