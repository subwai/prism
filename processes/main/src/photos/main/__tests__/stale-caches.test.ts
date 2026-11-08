import { removeStaleCaches } from '#photos/main/stale-caches';
import { THUMBNAIL_DIRECTORY_NAME } from '#photos/main/thumbnail-directory';
import { INDEX_FILE_NAME } from '@prism/catalog';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

const DAY_MS = 24 * 60 * 60 * 1000;

test('caches of other versions go once nothing has used them for a month', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'stale-caches-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const now = Date.now();
  const files = {
    [INDEX_FILE_NAME]: 60,
    'keybindings.json': 60,
    'last-folder.json': 60,
    'photo-index-v0.db': 60,
    'photo-index-v0.db-shm': 60,
    'photo-index-v0.db-wal': 60,
    // Another version's, but a build of it wrote to its journal last week.
    'photo-index-v99.db': 60,
    'photo-index-v99.db-wal': 7,
  };
  const folders = {
    [THUMBNAIL_DIRECTORY_NAME]: 60,
    'photo-thumbnails-v0': 60,
    'photo-thumbnails-v98': 2,
  };
  for (const name of Object.keys(folders)) {
    await mkdir(path.join(directory, name));
    await writeFile(path.join(directory, name, 'a.webp'), '');
  }
  for (const name of Object.keys(files)) {
    await writeFile(path.join(directory, name), '');
  }
  for (const [name, days] of Object.entries({ ...files, ...folders })) {
    const time = new Date(now - days * DAY_MS);
    await utimes(path.join(directory, name), time, time);
  }
  await removeStaleCaches(directory, now);
  expect((await readdir(directory)).toSorted()).toEqual(
    [
      INDEX_FILE_NAME,
      THUMBNAIL_DIRECTORY_NAME,
      'keybindings.json',
      'last-folder.json',
      'photo-index-v99.db',
      'photo-index-v99.db-wal',
      'photo-thumbnails-v98',
    ].toSorted(),
  );
});
