import { errorMessage } from '#photos/errors';
import { listable, mediaKind } from '#photos/media';
import type { PhotoEntry, PhotoExif, ScanBatch, ScanOptions } from '@prism/shared';
import type { Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Metadata is read this many files at a time.
const STAT_BATCH = 64;

export type ScanItem = { entry: PhotoEntry } | { error: ScanBatch['errors'][number] };

/**
 * How much a listing tells of each entry: only its name and kind, its file's metadata too, or
 * photos' EXIF details as well. Each tells everything the ones before it do.
 */
export type Detail = 'names' | 'metadata' | 'exif';
const DETAILS: Detail[] = ['names', 'metadata', 'exif'];

/** What a scan with `options` asks to know of each entry. */
export function detailOf(options: Pick<ScanOptions, 'metadata' | 'exif'>): Detail {
  if (options.exif) {
    return 'exif';
  }
  return options.metadata ? 'metadata' : 'names';
}

/** Whether a listing that tells `known` tells what `wanted` asks for. */
export function tells(known: Detail, wanted: Detail): boolean {
  return DETAILS.indexOf(known) >= DETAILS.indexOf(wanted);
}

/** Reads the EXIF details of the photo `file`, which is as `info` says. */
export type ExifReader = (file: string, info: Stats) => Promise<PhotoExif>;

/**
 * Reads the entries directly inside `directoryId` from the disk, with as much `detail` as asked
 * for, photos' EXIF details coming from `exif`. `resolve` finds the folder on disk; entry IDs
 * are relative to the canonical `root`, as it expects.
 */
export async function* readFolder(
  root: string,
  directoryId: string,
  {
    detail,
    signal,
    resolve,
    exif,
  }: {
    detail: Detail;
    signal: AbortSignal;
    resolve: (id: string) => Promise<string>;
    exif?: ExifReader;
  },
): AsyncGenerator<ScanItem, void> {
  const directory = await resolve(directoryId);
  const base = path.relative(root, directory);
  const listing = listable(await readdir(directory, { withFileTypes: true }));
  for (let start = 0; start < listing.length; start += STAT_BATCH) {
    const chunk = listing.slice(start, start + STAT_BATCH);
    const infos =
      detail === 'names'
        ? []
        : await Promise.allSettled(chunk.map((dirent) => stat(path.join(directory, dirent.name))));
    const details =
      detail === 'exif' && exif
        ? await Promise.allSettled(
            chunk.map((dirent, offset) => {
              const info = infos[offset];
              return info?.status === 'fulfilled' &&
                dirent.isFile() &&
                mediaKind(dirent.name) === 'image'
                ? exif(path.join(directory, dirent.name), info.value)
                : undefined;
            }),
          )
        : [];
    for (const [offset, dirent] of chunk.entries()) {
      signal.throwIfAborted();
      const entry: PhotoEntry = {
        id: path.join(base, dirent.name),
        kind: dirent.isDirectory()
          ? 'directory'
          : (dirent.isFile() && mediaKind(dirent.name)) || 'file',
        name: dirent.name,
        parentId: directoryId,
      };
      const info = infos[offset];
      // IDs are paths relative to the root, so they say where an entry that fails is.
      if (info?.status === 'fulfilled') {
        entry.metadata = {
          accessedMs: info.value.atimeMs,
          createdMs: info.value.birthtimeMs,
          modifiedMs: info.value.mtimeMs,
          size: info.value.size,
        };
      } else if (info) {
        yield { error: { entryId: entry.id, message: errorMessage(info.reason), path: entry.id } };
      }
      const read = details[offset];
      if (read?.status === 'fulfilled' && read.value) {
        entry.exif = read.value;
      } else if (read?.status === 'rejected') {
        yield { error: { entryId: entry.id, message: errorMessage(read.reason), path: entry.id } };
      }
      yield { entry };
    }
  }
}
