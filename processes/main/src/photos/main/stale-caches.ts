import { THUMBNAIL_DIRECTORY_NAME, THUMBNAIL_INDEX_NAME } from '#photos/main/thumbnail-directory';
import { INDEX_FILE_NAME } from '@prism/catalog';
import { app } from 'electron';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
// Caches of other versions that nothing has written to for this long are removed.
const UNUSED_MS = 30 * DAY_MS;
// The app can stay open for weeks, so it looks again this often.
const CHECK_MS = DAY_MS;

/**
 * The caches the app keeps in its user data folder, each in a file or folder named for its
 * version: the one this build uses, and what the others it may find are called, journals aside.
 */
const CACHES = [
  { current: INDEX_FILE_NAME, other: /^photo-index(?:-v\d+)?\.db$/u },
  { current: THUMBNAIL_DIRECTORY_NAME, other: /^photo-thumbnails-v\d+$/u },
  { current: THUMBNAIL_INDEX_NAME, other: /^photo-thumbnails-v\d+\.db$/u },
];

/** When `file`, or its SQLite journal, was last written to; 0 if neither is there. */
async function lastWritten(file: string) {
  const times = await Promise.all(
    ['', '-wal'].map((suffix) =>
      stat(`${file}${suffix}`).then(
        (info) => info.mtimeMs,
        () => 0,
      ),
    ),
  );
  return Math.max(...times);
}

/**
 * Removes the caches of other versions in `directory`, with their journals, once nothing has
 * written to them for a month. Another version's may still be in use by a build that is open,
 * such as the installed app beside a development one, so recent ones stay. A thumbnail folder
 * counts as written to when a thumbnail is added to it, as each is written in the folder itself
 * first, and its index when a thumbnail is made or used.
 */
export async function removeStaleCaches(
  directory = app.getPath('userData'),
  now = Date.now(),
): Promise<void> {
  for (const name of await readdir(directory).catch(() => [])) {
    const base = name.replace(/-(?:wal|shm)$/u, '');
    const stale = CACHES.some(({ current, other }) => base !== current && other.test(base));
    if (stale && now - (await lastWritten(path.join(directory, base))) > UNUSED_MS) {
      await rm(path.join(directory, name), { force: true, recursive: true });
    }
  }
}

function tidy() {
  removeStaleCaches().catch((error: unknown) =>
    process.emitWarning(`Removing old caches failed: ${String(error)}`),
  );
}

/** Removes stale caches now and once a day for as long as the app runs. */
export function keepCachesTidy(): void {
  tidy();
  setInterval(tidy, CHECK_MS).unref();
}
