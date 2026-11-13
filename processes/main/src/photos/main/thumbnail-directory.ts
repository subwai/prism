import type { Command } from '@prism/keybindings';
import {
  forgetCachedThumbnails,
  type ThumbnailCache,
  thumbnailCache,
  upkeepThumbnailCache,
} from '@prism/media';
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

/** The index of the thumbnail folder, beside it; see `thumbnailCache`. */
export const THUMBNAIL_INDEX_NAME = `${THUMBNAIL_DIRECTORY_NAME}.db`;

/** Where every folder's worker caches thumbnails, shared between them. */
export function thumbnailDirectory(): string {
  return path.join(app.getPath('userData'), THUMBNAIL_DIRECTORY_NAME);
}

let cache: ThumbnailCache | undefined;

/** The thumbnail cache as the main process serves it. */
export function mainThumbnailCache(): ThumbnailCache {
  cache ??= thumbnailCache(thumbnailDirectory());
  return cache;
}

/**
 * Brings the thumbnail cache up to date in the background (see `upkeepThumbnailCache`). Its
 * index is opened now, before any worker, so its tables are brought up to date only once.
 */
export function upkeepThumbnails(): void {
  upkeepThumbnailCache(mainThumbnailCache()).catch((error: unknown) =>
    process.emitWarning(`Tidying the thumbnail cache failed: ${String(error)}`),
  );
}

/**
 * Deletes every cached thumbnail, and forgets them in the index, then has `window` refresh so it
 * asks for new ones. Thumbnails being written meanwhile land in a recreated folder.
 */
export async function resetThumbnailCache(window: BrowserWindow): Promise<void> {
  await rm(thumbnailDirectory(), { force: true, recursive: true });
  forgetCachedThumbnails(mainThumbnailCache());
  if (!window.isDestroyed()) {
    window.webContents.send(COMMAND_CHANNEL, 'refresh' satisfies Command);
  }
}
