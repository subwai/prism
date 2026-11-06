import { PhotoIndex } from '#photos/photo-index';
import type { Command } from '@prism/keybindings';
import { COMMAND_CHANNEL } from '@prism/shared';
import { app, type BrowserWindow } from 'electron';
import path from 'node:path';

/** Where every folder's worker keeps what it read from photos, shared between them. */
export function photoIndexFile(): string {
  return path.join(app.getPath('userData'), 'photo-index.db');
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
