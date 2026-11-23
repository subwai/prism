import { readFolder } from '#photos/worker/disk/read-folder';
import { PhotoLibrary } from '#photos/worker/library/library';
import { prepareIndex, prepareRatings } from '@prism/catalog';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { onTestFinished, vi } from 'vitest';

export async function folder(prefix: string) {
  const made = await mkdtemp(path.join(tmpdir(), prefix));
  onTestFinished(() => rm(made, { force: true, recursive: true }));
  return realpath(made);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Opens the library at `root` on the catalog kept in `catalog`, as each launch does, `atMs` from
 * now if given.
 */
export function launch(root: string, catalog: string, atMs = 0) {
  const library = PhotoLibrary.open(root, {
    files: {
      index: prepareIndex(path.join(catalog, 'index.db')),
      ratings: prepareRatings(path.join(catalog, 'ratings.db')),
    },
    now: () => Date.now() + atMs,
  });
  onTestFinished(() => library.close());
  return library;
}

/** The folders listed since the last call, as a test that mocks `readFolder` sees them. */
export function listed() {
  const ids = vi.mocked(readFolder).mock.calls.map(([, directoryId]) => directoryId);
  vi.mocked(readFolder).mockClear();
  return ids.toSorted();
}

/**
 * The entries of `folderId` once the catalog holds what its reads wrote, which a launch's walk
 * settles before; it is read first unless this session read it.
 */
export async function entriesIn(library: PhotoLibrary, folderId: string) {
  await library.readFolder(folderId);
  return (await library.listFolder(folderId)).entries;
}

export async function sizeIn(library: PhotoLibrary, id: string) {
  const entries = await entriesIn(library, path.dirname(id));
  return entries.find((entry) => entry.id === id)?.metadata?.size;
}

export function idsOf(entries: { id: string }[]) {
  return entries.map((entry) => entry.id);
}
