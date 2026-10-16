import { PhotoBackendClient } from '#photos/client';
import {
  PHOTO_CHANNELS,
  type PhotoFolder,
  type ScanOptions,
  type ThumbnailRequest
} from '@app/shared';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  net,
  protocol
} from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const METHOD_NOT_ALLOWED = 405,
  NOT_FOUND = 404;

export function registerPhotosAPI(): void {
  const cacheDirectory = path.join(app.getPath('userData'), 'photo-thumbnails-v1'),
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
    const client = new PhotoBackendClient(root, cacheDirectory);
    sessions.set(owner, { client, id: randomUUID() });
    return client.folder;
  }

  function ownerOf(event: IpcMainInvokeEvent): number {
    const frame = event.senderFrame,
      allowed = new URL(
        app.isPackaged ? 'app://app/' : (process.env.ELECTRON_RENDERER_URL ?? 'app://app/')
      ),
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
      throw new Error('Select a folder first.');
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
  ipcMain.handle(PHOTO_CHANNELS.cancelThumbnail, (event, requestId: string) =>
    clientOf(event).call('cancelThumbnail', requestId)
  );
  ipcMain.handle(PHOTO_CHANNELS.requestThumbnail, (event, request: ThumbnailRequest) =>
    clientOf(event).call('requestThumbnail', request)
  );
  ipcMain.handle(PHOTO_CHANNELS.getOriginalURL, async (event, entryId: string) => {
    const client = clientOf(event),
      session = sessions.get(event.sender.id);
    if (!session) {
      throw new Error('Select a folder first.');
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
        return await net.fetch(pathToFileURL(file).href, { method: request.method });
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
