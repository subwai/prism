import type { PhotoBackendClient } from '#photos/client';
import { popUpEntryMenu } from '#photos/entry-menu';
import { photoIndexFile, removeOldIndexes } from '#photos/index-file';
import { lastFolder, rememberFolder } from '#photos/last-folder';
import { originalURL, registerMediaProtocol } from '#photos/media-protocol';
import { PhotoSessions } from '#photos/sessions';
import { thumbnailDirectory } from '#photos/thumbnail-directory';
import { isRendererURL } from '#renderer-url';
import { type MenuPosition, PHOTO_CHANNELS } from '@prism/shared';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';

const NO_FOLDER = 'Select a folder first.';

export function registerPhotosAPI(): void {
  const sessions = new PhotoSessions(thumbnailDirectory(), photoIndexFile()),
    choosing = new Map<number, symbol>(),
    tracked = new Set<number>();
  removeOldIndexes().catch(() => null);

  function close(owner: number): void {
    choosing.delete(owner);
    sessions.close(owner);
  }

  /** The window asking, which must be the application's own page; its folder closes with it. */
  function ownerOf(event: IpcMainInvokeEvent): number {
    const frame = event.senderFrame,
      owner = event.sender.id;
    if (!frame || frame !== event.sender.mainFrame || !isRendererURL(frame.url)) {
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

  /**
   * Opens `root` for the window asking, and gives it a port to call the folder's worker on;
   * the port arrives before the folder does.
   */
  async function open(event: IpcMainInvokeEvent, owner: number, root: string) {
    const { client } = sessions.open(owner, root);
    const folder = await client.folder;
    event.sender.postMessage(PHOTO_CHANNELS.worker, null, [await client.connect()]);
    return folder;
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
      const folder = await open(event, owner, root);
      await rememberFolder(root);
      return folder;
    } finally {
      if (choosing.get(owner) === token) {
        choosing.delete(owner);
      }
    }
  });
  // Only reopens a folder the user picked through the dialog in an earlier session.
  ipcMain.handle(PHOTO_CHANNELS.restoreFolder, async (event) => {
    const owner = ownerOf(event),
      root = await lastFolder();
    if (!root || sessions.get(owner) || choosing.has(owner) || event.sender.isDestroyed()) {
      return null;
    }
    return open(event, owner, root).catch(() => null);
  });
  ipcMain.handle(PHOTO_CHANNELS.closeFolder, (event) => close(ownerOf(event)));
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
        position,
      );
    },
  );
  ipcMain.handle(PHOTO_CHANNELS.getOriginalURL, async (event, entryId: string) => {
    const session = sessions.get(ownerOf(event));
    if (!session) {
      throw new Error(NO_FOLDER);
    }
    await session.client.call('original', entryId);
    return originalURL(session.id, entryId);
  });

  registerMediaProtocol(sessions);
  app.on('will-quit', () => sessions.closeAll());
}
