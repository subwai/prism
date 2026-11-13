import type { Command } from '@prism/keybindings';
import { COMMAND_CHANNEL } from '@prism/shared';
import { app, type BrowserWindow } from 'electron';
import { rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * The folder thumbnails are cached in, named for how `thumbnailKey` names them and they are made:
 * raise its version whenever either changes, so the old folder goes as a whole once no build
 * uses it, rather than its files lingering until pruned.
 */
export const THUMBNAIL_DIRECTORY_NAME = 'photo-thumbnails-v4';

/** Where every folder's worker caches thumbnails, shared between them. */
export function thumbnailDirectory(): string {
  return path.join(app.getPath('userData'), THUMBNAIL_DIRECTORY_NAME);
}

/**
 * Deletes every cached thumbnail, then has `window` refresh so it asks for new ones. Thumbnails
 * being written meanwhile land in a recreated folder.
 */
export async function resetThumbnailCache(window: BrowserWindow): Promise<void> {
  await rm(thumbnailDirectory(), { force: true, recursive: true });
  if (!window.isDestroyed()) {
    window.webContents.send(COMMAND_CHANNEL, 'refresh' satisfies Command);
  }
}
