import { type PrismTrashManifest, unlistedFiles } from '#photos/worker/disk/trash/batch-manifest';
import { PrismTrashBatch } from '#photos/worker/disk/trash/prism-trash-batch';
import { PhotoLibrary } from '#photos/worker/library/library';
import { putBackBatch } from '#photos/worker/trash/undo';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

const DATE = new Date('2026-11-12T14:03:22.500Z');

/** A folder standing in for the top of a share, with the library's folder inside it. */
async function share(files: string[]) {
  // Its real path, as the library's paths are.
  const made = await mkdtemp(path.join(tmpdir(), 'prism-share-'));
  const top = await realpath(made);
  onTestFinished(() => rm(top, { force: true, recursive: true }));
  const library = path.join(top, 'Photos');
  for (const file of files) {
    await mkdir(path.join(library, path.dirname(file)), { recursive: true });
    await writeFile(path.join(library, file), file);
  }
  return { library, top };
}

/** How many items the manifest of `batch` lists, as saved so far. */
async function savedCount(batch: PrismTrashBatch) {
  const file = path.join(batch.dir, 'manifest.json');
  const isSaved = await lstat(file).then(
    () => true,
    () => false,
  );
  if (!isSaved) {
    return 0;
  }
  const manifest = JSON.parse(await readFile(file, 'utf8')) as PrismTrashManifest;
  return manifest.items.length;
}

test('the manifest is saved every 100 items, or once a second has passed, and at the end', async () => {
  const names = Array.from({ length: 103 }, (_unused, index) => `${index}.jpg`);
  const { library, top } = await share(names);
  let nowMs = 0;
  const batch = await PrismTrashBatch.open(library, { date: DATE, now: () => nowMs, top });

  for (const name of names.slice(0, 99)) {
    await batch.put(path.join(library, name));
  }
  expect(await savedCount(batch)).toBe(0);
  await batch.put(path.join(library, names[99] ?? ''));
  expect(await savedCount(batch)).toBe(100);

  await batch.put(path.join(library, names[100] ?? ''));
  nowMs = 1000;
  await batch.put(path.join(library, names[101] ?? ''));
  expect(await savedCount(batch)).toBe(102);

  await batch.put(path.join(library, names[102] ?? ''));
  await batch.finish();
  expect(await savedCount(batch)).toBe(103);
});

test('a run stopped between saves, as by a quit, is put back in full', async () => {
  const names = Array.from({ length: 120 }, (_unused, index) => `${index}.jpg`);
  const { library, top } = await share([...names, 'Trips/beach.jpg', 'Trips/Day 2/sea.jpg']);
  const photos = PhotoLibrary.open(await realpath(library));
  onTestFinished(() => photos.close());
  const batch = await PrismTrashBatch.open(library, { date: DATE, now: () => 0, top });
  for (const name of names) {
    await batch.put(path.join(library, name));
  }
  // A folder moved in whole after the last save comes back by its files.
  await batch.put(path.join(library, 'Trips'));
  // Finder's clutter in the batch is not an item.
  await writeFile(path.join(batch.dir, 'Photos', '.DS_Store'), '');
  expect(await savedCount(batch)).toBe(100);

  await expect(putBackBatch(photos, batch.dir)).resolves.toEqual({ renamed: [], restored: 122 });

  const back = await readdir(library, { recursive: true });
  expect(back.toSorted()).toEqual(
    [...names, 'Trips', 'Trips/beach.jpg', 'Trips/Day 2', 'Trips/Day 2/sea.jpg'].toSorted(),
  );
});

test('files inside an item the manifest lists are not items of their own', () => {
  expect(
    unlistedFiles(
      [path.join('Photos', 'Trips', 'a.jpg'), path.join('Photos', 'Trips 2', 'b.jpg'), 'c.jpg'],
      [path.join('Photos', 'Trips')],
    ),
  ).toEqual([path.join('Photos', 'Trips 2', 'b.jpg'), 'c.jpg']);
});
