import type { PhotoBackendClient } from '#photos/main/client';
import { currentFolder, rememberCurrentFolder } from '#photos/main/current-folder';
import { popUpEntryMenu } from '#photos/main/entry-menu';
import { lastFolder, rememberFolder } from '#photos/main/last-folder';
import { originalURL, registerMediaProtocol } from '#photos/main/media-protocol';
import { openedFolders, rememberOpenedFolders } from '#photos/main/opened-folders';
import { perFolderFilesWritten } from '#photos/main/per-folder-file';
import {
  closeAllSessions,
  closeSession,
  openSession,
  sendFocusToWorkers,
  sessionOf,
} from '#photos/main/sessions';
import { waitBeforeQuitting } from '#photos/main/wait-before-quitting';
import { requireOpenedFolders, requireString } from '#photos/validate';
import { isRendererURL } from '#renderer-url';
import { type MenuPosition, PHOTO_CHANNELS, type PhotoRoot } from '@prism/shared';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import { realpath } from 'node:fs/promises';

const NO_FOLDER = 'Select a folder first.';

/** Tells the window whether the catalog is being upgraded, which can take a minute. */
function sendUpgrading(window: WebContents, upgrading: boolean) {
  if (!window.isDestroyed()) {
    window.send(PHOTO_CHANNELS.upgrading, upgrading);
  }
}

/**
 * Opens `root` for the window asking, and gives it a port to call the folder's worker on; the
 * port arrives before the folder does.
 */
async function open(event: IpcMainInvokeEvent, owner: number, root: string) {
  const { client, id } = openSession(owner, root, () => sendUpgrading(event.sender, true));
  const folder = await client.folder.finally(() => sendUpgrading(event.sender, false));
  event.sender.postMessage(PHOTO_CHANNELS.worker, null, [await client.connect()]);
  return { ...folder, session: id } satisfies PhotoRoot;
}

export function registerPhotosAPI(): void {
  const choosing = new Map<number, symbol>();
  const tracked = new Set<number>();

  function close(owner: number): void {
    choosing.delete(owner);
    closeSession(owner);
  }

  /** The window asking, which must be the application's own page; its folder closes with it. */
  function ownerOf(event: IpcMainInvokeEvent): number {
    const frame = event.senderFrame;
    const owner = event.sender.id;
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

  function clientOf(event: IpcMainInvokeEvent): PhotoBackendClient {
    const session = sessionOf(ownerOf(event));
    if (!session) {
      throw new Error(NO_FOLDER);
    }
    return session.client;
  }

  ipcMain.handle(PHOTO_CHANNELS.openFolder, async (event) => {
    const owner = ownerOf(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    const token = Symbol('folder dialog');
    if (!window || choosing.has(owner)) {
      return null;
    }
    choosing.set(owner, token);
    try {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      const [picked] = result.filePaths;
      if (result.canceled || !picked) {
        return null;
      }
      // The folder's catalog and what is kept for it go by its canonical path, found while the
      // folder is at hand, as it was just picked, so a launch opens it without the disk.
      const root = await realpath(picked);
      if (event.sender.isDestroyed() || choosing.get(owner) !== token) {
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
  // Only reopens a folder the user picked through the dialog in an earlier session, whether or
  // not it is there now: the window shows it from its catalog, and says so if it is gone.
  ipcMain.handle(PHOTO_CHANNELS.restoreFolder, async (event) => {
    const owner = ownerOf(event);
    const root = await lastFolder();
    if (!root || sessionOf(owner) || choosing.has(owner) || event.sender.isDestroyed()) {
      return null;
    }
    return open(event, owner, root).catch(() => null);
  });
  ipcMain.handle(PHOTO_CHANNELS.closeFolder, (event) => close(ownerOf(event)));
  ipcMain.handle(PHOTO_CHANNELS.openedFolders, (event) => {
    const session = sessionOf(ownerOf(event));
    if (!session) {
      throw new Error(NO_FOLDER);
    }
    return openedFolders(session.root);
  });
  ipcMain.handle(
    PHOTO_CHANNELS.rememberOpenedFolders,
    async (event, sessionId: unknown, folders: unknown) => {
      const session = sessionOf(ownerOf(event));
      requireString(sessionId);
      requireOpenedFolders(folders);
      // The window may have opened another folder since, which these are not of.
      if (session?.id === sessionId) {
        await rememberOpenedFolders(session.root, folders);
      }
    },
  );
  ipcMain.handle(PHOTO_CHANNELS.currentFolder, (event) => {
    const session = sessionOf(ownerOf(event));
    if (!session) {
      throw new Error(NO_FOLDER);
    }
    return currentFolder(session.root);
  });
  ipcMain.handle(
    PHOTO_CHANNELS.rememberCurrentFolder,
    async (event, sessionId: unknown, folderId: unknown) => {
      const session = sessionOf(ownerOf(event));
      requireString(sessionId);
      requireString(folderId);
      // The window may have opened another folder since, which this is not inside.
      if (session?.id === sessionId) {
        await rememberCurrentFolder(session.root, folderId);
      }
    },
  );
  ipcMain.handle(
    PHOTO_CHANNELS.showEntryMenu,
    (event, entryId: string, position?: MenuPosition) => {
      const client = clientOf(event);
      const window = BrowserWindow.fromWebContents(event.sender);
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
    const session = sessionOf(ownerOf(event));
    if (!session) {
      throw new Error(NO_FOLDER);
    }
    await session.client.call('original', entryId);
    return originalURL(session.id, entryId);
  });

  registerMediaProtocol();
  // Moving from one Prism window to another blurs one before focusing the other, which the
  // workers see as a moment out of focus. That stops nothing already running.
  app.on('browser-window-focus', () => sendFocusToWorkers(true));
  app.on('browser-window-blur', () => sendFocusToWorkers(false));
  app.on('will-quit', closeAllSessions);
  waitBeforeQuitting(app, perFolderFilesWritten);
}
