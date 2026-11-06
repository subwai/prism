import type { PathChange } from '#photos/changes';
import { PhotoLibrary } from '#photos/library';
import { differences } from '#photos/listings';
import { PhotoIndex } from '#photos/photo-index';
import type { PhotoEntry, ScanOptions } from '@prism/shared';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'stored-listings-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function collect(library: PhotoLibrary, options: ScanOptions) {
  const scanId = library.startScan(options);
  const listed: PhotoEntry[] = [];
  let batch;
  do {
    batch = await library.nextBatch(scanId);
    listed.push(...batch.entries);
  } while (!batch.done);
  return listed;
}

/** Opens `root` as a session would, with the index at `indexFile`, telling `stale` what it missed. */
async function session(
  root: string,
  indexFile: string,
  stale = vi.fn<(changes: PathChange[]) => void>(),
) {
  const library = await PhotoLibrary.open(root, PhotoIndex.open(indexFile));
  library.onStale(stale);
  onTestFinished(() => library.close());
  return { library, stale };
}

const names = (entries: PhotoEntry[]) => entries.map((entry) => entry.name).toSorted();

test('a folder lists as it was last session, then catches up with what changed meanwhile', async () => {
  const root = await fixture();
  const indexFile = path.join(await fixture(), 'index.db');
  await writeFile(path.join(root, 'kept.jpg'), 'one');
  await writeFile(path.join(root, 'old.jpg'), '');
  const first = await session(root, indexFile);
  await collect(first.library, { directoryId: '.', metadata: true });
  await first.library.close();

  // While the app is closed, a photo comes, one goes and one is edited.
  await writeFile(path.join(root, 'new.jpg'), '');
  await rm(path.join(root, 'old.jpg'));
  await writeFile(path.join(root, 'kept.jpg'), 'longer');
  await utimes(path.join(root, 'kept.jpg'), new Date(2020, 0, 1), new Date(2020, 0, 1));

  const second = await session(root, indexFile);
  expect(names(await collect(second.library, { directoryId: '.' }))).toEqual([
    'kept.jpg',
    'old.jpg',
  ]);
  await vi.waitFor(() => expect(second.stale).toHaveBeenCalledOnce());
  const [missed] = second.stale.mock.calls[0] ?? [];
  expect(missed?.map((change) => change.id).toSorted()).toEqual(['kept.jpg', 'new.jpg', 'old.jpg']);
  const described = await second.library.describeChanges(missed ?? []);
  expect(
    Object.fromEntries(
      described.map((change) => [change.id, change.entry?.metadata?.size ?? null]),
    ),
  ).toEqual({
    'kept.jpg': 6,
    'new.jpg': 0,
    'old.jpg': null,
  });
  // Once described, the folder lists as it is now.
  expect(names(await collect(second.library, { directoryId: '.' }))).toEqual([
    'kept.jpg',
    'new.jpg',
  ]);
});

test('a folder that did not change lists from the index without telling of anything', async () => {
  const root = await fixture();
  const indexFile = path.join(await fixture(), 'index.db');
  await mkdir(path.join(root, 'a'));
  await writeFile(path.join(root, 'a', 'photo.jpg'), '');
  const first = await session(root, indexFile);
  await collect(first.library, { directoryId: '.', recursive: true });
  await first.library.close();

  const second = await session(root, indexFile);
  expect(names(await collect(second.library, { directoryId: '.', recursive: true }))).toEqual([
    'a',
    'photo.jpg',
  ]);
  // Asking for more than was stored reads the disk instead.
  const [photo] = await collect(second.library, { directoryId: 'a', metadata: true });
  expect(photo?.metadata).toBeDefined();
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(second.stale).not.toHaveBeenCalled();
});

test('a refresh lets go of stored listings, so the next session reads the disk', async () => {
  const root = await fixture();
  const indexFile = path.join(await fixture(), 'index.db');
  await writeFile(path.join(root, 'photo.jpg'), '');
  const first = await session(root, indexFile);
  await collect(first.library, { directoryId: '.' });
  first.library.forget();
  await first.library.close();
  await writeFile(path.join(root, 'new.jpg'), '');

  const second = await session(root, indexFile);
  expect(names(await collect(second.library, { directoryId: '.' }))).toEqual([
    'new.jpg',
    'photo.jpg',
  ]);
});

test('stored listings of folders inside one are dropped with it, and siblings that share its name are not', () => {
  const index = PhotoIndex.open(':memory:');
  onTestFinished(() => index.close());
  const listings = index.listings('/photos');
  const other = index.listings('/elsewhere');
  const stored = { detail: 'names' as const, entries: [] };
  for (const id of ['Trips', path.join('Trips', 'Rome'), 'Trips 2026', '100%_done']) {
    listings.set(id, stored);
  }
  other.set('Trips', stored);
  listings.forgetInside('Trips');
  expect(listings.get('Trips')).toBeUndefined();
  expect(listings.get(path.join('Trips', 'Rome'))).toBeUndefined();
  expect(listings.get('Trips 2026')).toEqual(stored);
  expect(other.get('Trips')).toEqual(stored);
  listings.forget(['100%_done']);
  expect(listings.get('100%_done')).toBeUndefined();
  listings.forgetInside('.');
  expect(listings.get('Trips 2026')).toBeUndefined();
  expect(other.get('Trips')).toEqual(stored);
});

/** A photo of `size` bytes, or a folder. */
function file(name: string, size: number, kind: PhotoEntry['kind'] = 'image'): PhotoEntry {
  return {
    id: name,
    kind,
    metadata: { accessedMs: 0, createdMs: 0, modifiedMs: 1, size },
    name,
    parentId: '.',
  };
}

test('differences name what came, went, changed kind or was rewritten', () => {
  const before = [file('same', 1), file('gone', 1), file('edited', 1), file('folder', 0)];
  const after = [
    file('same', 1),
    file('edited', 2),
    file('folder', 0, 'directory'),
    file('new', 1),
  ];
  expect(differences('.', before, after).map((change) => change.id)).toEqual([
    'edited',
    'folder',
    'new',
    'gone',
  ]);
});
