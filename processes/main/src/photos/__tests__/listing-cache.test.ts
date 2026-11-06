import { PhotoLibrary } from '#photos/library';
import { ListingCache } from '#photos/listings';
import type { PhotoEntry, ScanOptions } from '@prism/shared';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

function entries(count: number, parentId = '.'): PhotoEntry[] {
  return Array.from({ length: count }, (_entry, index) => ({
    id: path.join(parentId, `${index}.jpg`),
    kind: 'image',
    name: `${index}.jpg`,
    parentId,
  }));
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-listings-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function openLibrary(root: string) {
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  return library;
}

/** Everything a scan lists. */
async function collect(library: PhotoLibrary, options: ScanOptions) {
  const scanId = library.startScan(options);
  const listed = [];
  let batch;
  do {
    batch = await library.nextBatch(scanId);
    listed.push(...batch.entries);
  } while (!batch.done);
  return listed;
}

function remember(cache: ListingCache, directoryId: string, listed: PhotoEntry[]) {
  cache.end(cache.start(directoryId), false, listed);
}

test('a read under way when its folder is forgotten is not remembered', () => {
  const cache = new ListingCache();
  const forgotten = cache.start('a');
  const inside = cache.start(path.join('a', 'b'));
  const elsewhere = cache.start('c');
  cache.forget(['a']);
  cache.forgetInside('a');
  cache.end(forgotten, false, entries(1, 'a'));
  cache.end(inside, false, entries(1, path.join('a', 'b')));
  cache.end(elsewhere, false, entries(1, 'c'));
  expect(cache.get('a', false)).toBeUndefined();
  expect(cache.get(path.join('a', 'b'), false)).toBeUndefined();
  expect(cache.get('c', false)).toHaveLength(1);
});

test('reads that stopped early are not remembered', () => {
  const cache = new ListingCache();
  cache.end(cache.start('a'), false);
  expect(cache.get('a', false)).toBeUndefined();
});

test('a listing with metadata serves reads without it, not the other way round', () => {
  const cache = new ListingCache();
  cache.end(cache.start('a'), true, entries(1, 'a'));
  remember(cache, 'b', entries(1, 'b'));
  expect(cache.get('a', false)).toHaveLength(1);
  expect(cache.get('b', true)).toBeUndefined();
});

test('forgetting inside a folder leaves folders that only share its name alone', () => {
  const cache = new ListingCache();
  remember(cache, 'Trips', entries(1, 'Trips'));
  remember(cache, 'Trips 2026', entries(1, 'Trips 2026'));
  cache.forgetInside('Trips');
  expect(cache.get('Trips', false)).toBeUndefined();
  expect(cache.get('Trips 2026', false)).toHaveLength(1);
});

test('the folders used longest ago go once the cache holds too many entries', () => {
  const cache = new ListingCache();
  remember(cache, 'a', entries(80_000, 'a'));
  remember(cache, 'b', entries(80_000, 'b'));
  expect(cache.get('a', false)).toBeDefined();
  remember(cache, 'c', entries(80_000, 'c'));
  expect(cache.get('a', false)).toBeDefined();
  expect(cache.get('b', false)).toBeUndefined();
  expect(cache.get('c', false)).toBeDefined();
});

test('folders read before are listed again from memory until they change', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'a'));
  await writeFile(path.join(root, 'a', 'first.jpg'), '');
  const library = await openLibrary(root);
  const names = async (options: ScanOptions) =>
    (await collect(library, options)).map((entry) => entry.name).toSorted();
  expect(await names({ directoryId: '.', recursive: true })).toEqual(['a', 'first.jpg']);
  // Written without the watcher noticing, so only a read from the disk would find it.
  await writeFile(path.join(root, 'a', 'unseen.jpg'), '');
  expect(await names({ directoryId: 'a' })).toEqual(['first.jpg']);
  // Sorting by date needs metadata, which the listing in memory does not have.
  expect(await names({ directoryId: 'a', metadata: true })).toEqual(['first.jpg', 'unseen.jpg']);
  await writeFile(path.join(root, 'a', 'second.jpg'), '');
  await library.describeChanges([{ id: path.join('a', 'second.jpg'), parentId: 'a' }]);
  expect(await names({ directoryId: 'a' })).toEqual(['first.jpg', 'second.jpg', 'unseen.jpg']);
  await writeFile(path.join(root, 'a', 'third.jpg'), '');
  library.forget();
  expect(await names({ directoryId: 'a' })).toHaveLength(4);
});

test('a folder that goes takes the listings inside it along', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'a', 'b'), { recursive: true });
  await writeFile(path.join(root, 'a', 'b', 'old.jpg'), '');
  const library = await openLibrary(root);
  await collect(library, { directoryId: '.', recursive: true });
  await rm(path.join(root, 'a'), { recursive: true });
  await library.describeChanges([{ id: 'a', parentId: '.' }]);
  await mkdir(path.join(root, 'a', 'b'), { recursive: true });
  await writeFile(path.join(root, 'a', 'b', 'new.jpg'), '');
  const listed = await collect(library, { directoryId: path.join('a', 'b') });
  expect(listed.map((entry) => entry.name)).toEqual(['new.jpg']);
});
