import { PhotoBackendClient } from '#photos/client';
import { popUpEntryMenu } from '#photos/entry-menu';
import { errorMessage } from '#photos/errors';
import { fileResponse } from '#photos/file-response';
import type { Command } from '@prism/keybindings';
import {
  COMMAND_CHANNEL,
  type MenuPosition,
  PHOTO_CHANNELS,
  type PhotoFolder,
  type RenameResult,
  type ScanOptions,
  type ThumbnailFrame,
  type ThumbnailRequest,
  type ThumbnailResult
} from '@prism/shared';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  protocol,
  webContents
} from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const METHOD_NOT_ALLOWED = 405,
  NOT_FOUND = 404,
  NO_FOLDER = 'Select a folder first.',
  NO_FOLDER_THUMBNAIL: ThumbnailResult = { message: NO_FOLDER, status: 'failed' };

function thumbnailDirectory(): string {
  return path.join(app.getPath('userData'), 'photo-thumbnails-v1');
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

/** Where the application window loads from: the bundled app, or the dev server. */
function rendererURL(): URL {
  return new URL(
    app.isPackaged ? 'app://app/' : (process.env.ELECTRON_RENDERER_URL ?? 'app://app/')
  );
}

/** Spelled out: Node does not know `app:` is a standard scheme, so its `origin` is "null". */
function rendererOrigin(): string {
  const url = rendererURL();
  return `${url.protocol}//${url.host}`;
}

export function registerPhotosAPI(): void {
  const cacheDirectory = thumbnailDirectory(),
    lastFolderFile = path.join(app.getPath('userData'), 'last-folder.json'),
    sessions = new Map<number, { id: string; client: PhotoBackendClient }>(),
    choosing = new Map<number, symbol>(),
    tracked = new Set<number>();

  function close(owner: number): void {
    choosing.delete(owner);
    const session = sessions.get(owner);
    if (session) {
      session.client.stop();
    }
    sessions.delete(owner);
  }

  function start(owner: number, root: string): Promise<PhotoFolder> {
    close(owner);
    const client = new PhotoBackendClient(root, cacheDirectory, (changes) => {
      webContents.fromId(owner)?.send(PHOTO_CHANNELS.changed, changes);
    });
    sessions.set(owner, { client, id: randomUUID() });
    return client.folder;
  }

  function ownerOf(event: IpcMainInvokeEvent): number {
    const frame = event.senderFrame,
      allowed = rendererURL(),
      actual = new URL(frame ? frame.url : 'about:blank'),
      owner = event.sender.id;
    if (
      !frame ||
      frame !== event.sender.mainFrame ||
      actual.protocol !== allowed.protocol ||
      actual.host !== allowed.host
    ) {
      throw new Error('Photo API is only available to the application window.');
    }
    if (!tracked.has(owner)) {
      tracked.add(owner);
      event.sender.on('did-start-navigation', (_navigationEvent, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
          close(owner);
        }
      });
      event.sender.once('destroyed', () => {
        close(owner);
        tracked.delete(owner);
      });
    }
    return owner;
  }

  function clientOf(event: IpcMainInvokeEvent): PhotoBackendClient {
    const session = sessions.get(ownerOf(event));
    if (!session) {
      throw new Error(NO_FOLDER);
    }
    return session.client;
  }

  ipcMain.handle(PHOTO_CHANNELS.openFolder, async (event) => {
    const owner = ownerOf(event),
      window = BrowserWindow.fromWebContents(event.sender),
      token = Symbol('folder dialog');
    if (!window || choosing.has(owner)) {
      return null;
    }
    choosing.set(owner, token);
    try {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] }),
        [root] = result.filePaths;
      if (result.canceled || !root || event.sender.isDestroyed() || choosing.get(owner) !== token) {
        return null;
      }
      const folder = await start(owner, root);
      // Losing the remembered folder only costs a dialog on next launch.
      await writeFile(lastFolderFile, JSON.stringify({ root })).catch(() => null);
      return folder;
    } finally {
      if (choosing.get(owner) === token) {
        choosing.delete(owner);
      }
    }
  });
  // Only reopens a folder the user picked through the dialog in an earlier session.
  ipcMain.handle(PHOTO_CHANNELS.restoreFolder, async (event) => {
    const owner = ownerOf(event);
    try {
      const { root } = JSON.parse(await readFile(lastFolderFile, 'utf8')) as { root?: unknown };
      if (typeof root !== 'string' || !(await stat(root)).isDirectory()) {
        return null;
      }
      if (sessions.has(owner) || choosing.has(owner) || event.sender.isDestroyed()) {
        return null;
      }
      return await start(owner, root);
    } catch {
      return null;
    }
  });
  ipcMain.handle(PHOTO_CHANNELS.closeFolder, (event) => close(ownerOf(event)));
  ipcMain.handle(PHOTO_CHANNELS.startScan, (event, options: ScanOptions) =>
    clientOf(event).call('startScan', options)
  );
  ipcMain.handle(PHOTO_CHANNELS.nextBatch, (event, scanId: string) =>
    clientOf(event).call('nextBatch', scanId)
  );
  ipcMain.handle(PHOTO_CHANNELS.cancelScan, (event, scanId: string) =>
    clientOf(event).call('cancelScan', scanId)
  );
  ipcMain.handle(PHOTO_CHANNELS.inspectFolder, (event, directoryId: string) =>
    clientOf(event).call('inspectFolder', directoryId)
  );
  // Thumbnails are background work: a page that is reloading keeps asking for its queued ones
  // after its session closed. They fail quietly, as Electron logs every error a handler throws.
  ipcMain.handle(PHOTO_CHANNELS.cancelThumbnail, (event, requestId: string) =>
    sessions.get(ownerOf(event))?.client.call('cancelThumbnail', requestId)
  );
  ipcMain.handle(PHOTO_CHANNELS.requestThumbnail, (event, request: ThumbnailRequest) => {
    const session = sessions.get(ownerOf(event));
    return session ? session.client.call('requestThumbnail', request) : NO_FOLDER_THUMBNAIL;
  });
  ipcMain.handle(PHOTO_CHANNELS.storeThumbnail, (event, frame: ThumbnailFrame) => {
    const session = sessions.get(ownerOf(event));
    return session ? session.client.call('storeThumbnail', frame) : NO_FOLDER_THUMBNAIL;
  });
  ipcMain.handle(
    PHOTO_CHANNELS.showEntryMenu,
    (event, entryId: string, position?: MenuPosition) => {
      const client = clientOf(event),
        window = BrowserWindow.fromWebContents(event.sender);
      if (!window || typeof entryId !== 'string') {
        return null;
      }
      // The open folder itself, whose ID is '.', is renamed by opening its parent instead.
      return popUpEntryMenu(
        window,
        () => client.call('resolve', entryId),
        entryId !== '.',
        position
      );
    }
  );
  // Failures are the user's to read, such as a name already taken, so they come back as values.
  ipcMain.handle(
    PHOTO_CHANNELS.renameEntry,
    async (event, entryId: string, name: string): Promise<RenameResult> => {
      const client = clientOf(event);
      try {
        return await client.call('rename', entryId, name);
      } catch (error) {
        return { error: errorMessage(error) };
      }
    }
  );
  ipcMain.handle(PHOTO_CHANNELS.getOriginalURL, async (event, entryId: string) => {
    const client = clientOf(event),
      session = sessions.get(event.sender.id);
    if (!session) {
      throw new Error(NO_FOLDER);
    }
    await client.call('original', entryId);
    return `media://original/${session.id}/${encodeURIComponent(entryId)}`;
  });

  protocol.handle('media', async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('', { status: METHOD_NOT_ALLOWED });
    }
    const url = new URL(request.url);
    try {
      let file = '';
      if (url.host === 'thumbnail' && /^\/[a-f\d]{64}\.webp$/u.test(url.pathname)) {
        file = path.join(cacheDirectory, url.pathname.slice(1));
      } else if (url.host === 'original') {
        const [, sessionId, entryId] = url.pathname.split('/'),
          session = [...sessions.values()].find((candidate) => candidate.id === sessionId);
        if (session && entryId) {
          file = await session.client.call('original', decodeURIComponent(entryId));
        }
      }
      if (file) {
        // The window draws videos to take their stills, which needs them shared with it.
        const headers = new Headers({ 'Access-Control-Allow-Origin': rendererOrigin() });
        return await fileResponse(file, request, headers);
      }
    } catch {
      // Removed files and closed sessions are normal while browsing.
    }
    return new Response('', { status: NOT_FOUND });
  });
  app.on('will-quit', () => {
    for (const owner of sessions.keys()) {
      close(owner);
    }
  });
}
