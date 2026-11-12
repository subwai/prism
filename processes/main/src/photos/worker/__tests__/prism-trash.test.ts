import { PhotoLibrary } from '#photos/worker/library';
import {
  batchName,
  PrismTrashBatch,
  type PrismTrashManifest,
  volumeTopOf,
} from '#photos/worker/prism-trash';
import { runTrashPlan, undoTrashRun } from '#photos/worker/trash-run';
import { listable } from '@prism/media';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

const NO_COUNTS = { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };
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

async function manifestOf(batch: PrismTrashBatch) {
  return JSON.parse(
    await readFile(path.join(batch.dir, 'manifest.json'), 'utf8'),
  ) as PrismTrashManifest;
}

function exists(file: string) {
  return lstat(file).then(
    () => true,
    () => false,
  );
}

test('a batch is named by when its run began, sortably and safely on every disk', () => {
  expect(batchName(DATE)).toBe('2026-11-12T14-03-22Z');
});

test('the top of a volume is the highest folder above on the same disk', async () => {
  const { library } = await share(['a.jpg']);
  const top = await volumeTopOf(path.join(library, 'a.jpg'));

  expect(path.join(library, 'a.jpg').startsWith(top)).toBe(true);
  const { dev } = await stat(top);
  expect(dev).toBe((await stat(library)).dev);
  const above = path.dirname(top);
  // Either the top of everything, or a folder on another disk.
  expect(above === top || (await stat(above)).dev !== dev).toBe(true);
});

test('items move into the batch at their paths from the top, which the manifest records', async () => {
  const { library, top } = await share(['Trips/beach.jpg', 'loose.jpg']);
  const batch = await PrismTrashBatch.open(library, { date: DATE, top });

  const landed = await batch.put(path.join(library, 'Trips'));

  expect(batch.dir).toBe(path.join(top, '.prism-trash', '2026-11-12T14-03-22Z'));
  expect(landed).toBe(path.join(batch.dir, 'Photos', 'Trips'));
  await expect(readFile(path.join(landed, 'beach.jpg'), 'utf8')).resolves.toBe('Trips/beach.jpg');
  await expect(manifestOf(batch)).resolves.toEqual({
    items: [{ at: path.join('Photos', 'Trips'), from: path.join(library, 'Trips') }],
    library,
    trashedAt: DATE.toISOString(),
    version: 1,
  });
});

test('runs a second apart get batches of their own', async () => {
  const { library, top } = await share([]);
  const first = await PrismTrashBatch.open(library, { date: DATE, top });
  const second = await PrismTrashBatch.open(library, { date: DATE, top });

  expect(path.basename(first.dir)).toBe('2026-11-12T14-03-22Z');
  expect(path.basename(second.dir)).toBe('2026-11-12T14-03-22Z-2');
});

test('a run into Prism’s Trash is undone, and the Trash goes once empty', async () => {
  const { library, top } = await share(['Trips/beach.jpg', 'Trips/good.jpg', 'loose.jpg']);
  const photos = await PhotoLibrary.open(library);
  onTestFinished(() => photos.close());
  const batch = await PrismTrashBatch.open(library, { date: DATE, top });
  const plan = {
    groups: [],
    moves: [{ id: 'Trips/good.jpg', to: '.' }],
    rescued: NO_COUNTS,
    targets: ['Trips', 'loose.jpg'],
    totals: NO_COUNTS,
  };

  const { run, error } = await runTrashPlan(
    photos,
    plan,
    { batch: batch.dir, put: (file) => batch.put(file) },
    vi.fn(),
  );

  expect(error).toBeUndefined();
  expect(await readdir(library)).toEqual(['good.jpg']);
  expect((await readdir(path.join(batch.dir, 'Photos'))).toSorted()).toEqual([
    'Trips',
    'loose.jpg',
  ]);
  await expect(undoTrashRun(photos, run)).resolves.toEqual({ renamed: [], restored: 3 });
  expect((await readdir(library)).toSorted()).toEqual(['Trips', 'loose.jpg']);
  expect((await readdir(path.join(library, 'Trips'))).toSorted()).toEqual([
    'beach.jpg',
    'good.jpg',
  ]);
  expect(await exists(path.join(top, '.prism-trash'))).toBe(false);
});

test('Prism’s Trash shows in no listing', async () => {
  const { top } = await share(['a.jpg']);
  await mkdir(path.join(top, '.prism-trash'));

  const names = listable(await readdir(top, { withFileTypes: true })).map(({ name }) => name);

  expect(names).toEqual(['Photos']);
});
