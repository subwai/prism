import { PhotoLibrary } from '#photos/worker/library';
import { rateEntry } from '#photos/worker/rating';
import { renameEntry } from '#photos/worker/rename';
import {
  generateThumbnail,
  hasThumbnail,
  readExif,
  thumbnailCache,
  thumbnailKey,
} from '@prism/media';
import { emptyFilter, type ViewSpec } from '@prism/shared';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test } from 'vitest';

async function listed() {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-rating-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, 'Trips'));
  await sharp({ create: { background: 'red', channels: 3, height: 8, width: 8 } })
    .jpeg()
    .toFile(path.join(root, 'beach.jpg'));
  await writeFile(path.join(root, 'clip.mp4'), 'video');
  const library = await PhotoLibrary.open(root);
  onTestFinished(() => library.close());
  await library.listFolder('.');
  const cache = thumbnailCache(path.join(root, '.thumbnails'));
  return { cache, library, root };
}

/** The IDs and ratings a view of the library's folder shows. */
async function ratings(library: PhotoLibrary, overrides: Partial<ViewSpec> = {}) {
  const view = await library.views.open({
    descending: false,
    directoryId: '.',
    filter: emptyFilter(),
    recursive: false,
    search: '',
    show: 'all',
    sort: 'name',
    suggesting: false,
    ...overrides,
  });
  const states = await library.views.current();
  const { version } = states.find(({ viewId }) => viewId === view.viewId) ?? view;
  const rows = await library.views.rows(view.viewId, version, 0, 10);
  return Object.fromEntries((rows ?? []).map((row) => [row.id, row.rating]));
}

test('a photo is rated in its own file, keeping its thumbnail', async () => {
  const { cache, library, root } = await listed();
  const file = path.join(root, 'beach.jpg');
  const before = { file, info: await stat(file) };
  const { signal } = new AbortController();
  await generateThumbnail(cache, before, thumbnailKey(before, false), signal);

  const entry = await rateEntry(library, cache, 'beach.jpg', 4);
  expect(entry).toMatchObject({ id: 'beach.jpg', rating: 4 });
  expect((await readExif(file)).rating).toBe(4);
  const after = thumbnailKey({ file, info: await stat(file) }, false);
  await expect(hasThumbnail(cache, after)).resolves.toBe(true);
  // The watcher's report of the rewrite has nothing left to say.
  await expect(library.describeChanges([{ id: 'beach.jpg', parentId: '.' }])).resolves.toEqual([]);
  expect(await ratings(library)).toMatchObject({ 'beach.jpg': 4 });

  expect(await rateEntry(library, cache, 'beach.jpg', null)).not.toHaveProperty('rating');
  expect((await readExif(file)).rating).toBeUndefined();
});

test('folders and videos are rated in the ratings file, which a rename carries along', async () => {
  const { cache, library } = await listed();
  await rateEntry(library, cache, 'Trips', 5);
  await rateEntry(library, cache, 'clip.mp4', 2);
  expect(await ratings(library)).toEqual({ Trips: 5, 'beach.jpg': undefined, 'clip.mp4': 2 });
  expect(await ratings(library, { filter: { ...emptyFilter(), rating: ['3'] } })).toEqual({
    Trips: 5,
  });

  await renameEntry(library, 'Trips', 'Travel');
  expect(await ratings(library)).toMatchObject({ Travel: 5 });
  await rateEntry(library, cache, 'Travel', null);
  expect(await ratings(library)).toMatchObject({ Travel: undefined });
});

test('only one to five stars, or none, rate an entry', async () => {
  const { cache, library } = await listed();
  expect(() => rateEntry(library, cache, 'Trips', 6 as never)).toThrow(/one to five/u);
  await expect(rateEntry(library, cache, '.', 3)).rejects.toThrow(/open folder/u);
});
