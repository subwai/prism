import { removeOldIndexes } from '#photos/index-file';
import { INDEX_FILE_NAME } from '#photos/photo-index';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

const DAY_MS = 24 * 60 * 60 * 1000;

test('index files of other versions go once nothing has used them for a month', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-files-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  const now = Date.now();
  const files = {
    [INDEX_FILE_NAME]: 60,
    'last-folder.json': 60,
    'photo-index-v0.db': 60,
    'photo-index-v0.db-shm': 60,
    'photo-index-v0.db-wal': 60,
    // Another version's, but a build of it wrote to its journal last week.
    'photo-index-v99.db': 60,
    'photo-index-v99.db-wal': 7,
    'photo-index.db': 60,
  };
  for (const [name, days] of Object.entries(files)) {
    const file = path.join(directory, name);
    await writeFile(file, '');
    const time = new Date(now - days * DAY_MS);
    await utimes(file, time, time);
  }
  await removeOldIndexes(directory, now);
  expect((await readdir(directory)).toSorted()).toEqual(
    [
      INDEX_FILE_NAME,
      'last-folder.json',
      'photo-index-v99.db',
      'photo-index-v99.db-wal',
    ].toSorted(),
  );
});
