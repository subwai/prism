import { INDEX_FILE_NAME } from '@prism/catalog';
import type { Command } from '@prism/keybindings';
import { COMMAND_CHANNEL } from '@prism/shared';
import { app, type BrowserWindow } from 'electron';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

/** Where every folder's worker keeps what it read from photos, shared between them. */
export function photoIndexFile(): string {
  return path.join(app.getPath('userData'), INDEX_FILE_NAME);
}

/**
 * Forgets what was read from every photo, then has `window` refresh so it reads its photos
 * again. The workers share the file, so emptying it reaches them all. It runs on a thread of
 * its own, as it can take seconds in a large index.
 */
export async function resetPhotoIndex(window: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(path.join(import.meta.dirname, 'forget-details-thread.js'), {
      workerData: photoIndexFile(),
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Forgetting photos' details stopped with code ${code}.`));
      }
    });
  });
  if (!window.isDestroyed()) {
    window.webContents.send(COMMAND_CHANNEL, 'refresh' satisfies Command);
  }
}
