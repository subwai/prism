import { INDEX_FILE_NAME, PhotoIndex } from '#photos/photo-index';
import type { Command } from '@prism/keybindings';
import { COMMAND_CHANNEL } from '@prism/shared';
import { app, type BrowserWindow } from 'electron';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

// Index files of other versions that nothing has written to for this long are removed.
const UNUSED_MS = 30 * 24 * 60 * 60 * 1000;

/** Where every folder's worker keeps what it read from photos, shared between them. */
export function photoIndexFile(): string {
  return path.join(app.getPath('userData'), INDEX_FILE_NAME);
}

/**
 * Removes the index files of other versions, with their journals, once no build of that
 * version has used them for a while: an older version's may still be in use by a build that is
 * open, such as the installed app beside a development one.
 */
export async function removeOldIndexes(
  directory = app.getPath('userData'),
  now = Date.now(),
): Promise<void> {
  const names = await readdir(directory).catch(() => []);
  const current = INDEX_FILE_NAME;
  for (const name of names) {
    const base = name.replace(/-(?:wal|shm)$/u, '');
    if (!/^photo-index(?:-v\d+)?\.db$/u.test(base) || base === current) {
      continue;
    }
    const used = await Promise.all(
      ['', '-wal'].map((suffix) =>
        stat(path.join(directory, `${base}${suffix}`)).then(
          (info) => info.mtimeMs,
          () => 0,
        ),
      ),
    );
    if (now - Math.max(...used) > UNUSED_MS) {
      await rm(path.join(directory, name), { force: true });
    }
  }
}

/**
 * Forgets what was read from every photo, then has `window` refresh so it reads its photos
 * again. The workers share the file, so emptying it reaches them all.
 */
export function resetPhotoIndex(window: BrowserWindow): void {
  const index = PhotoIndex.open(photoIndexFile());
  try {
    index.clear();
  } finally {
    index.close();
  }
  if (!window.isDestroyed()) {
    window.webContents.send(COMMAND_CHANNEL, 'refresh' satisfies Command);
  }
}
