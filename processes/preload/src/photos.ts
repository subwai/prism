import {
  debug,
  errorMessage,
  type LibraryUpdate,
  PHOTO_CHANNELS,
  type PhotosAPI,
  type PhotoWorkerAPI,
  type TrashAPI,
  type TrashProgress,
  WorkerClient,
  type WorkerEvent,
  type WorkerResponse,
} from '@prism/shared';
import { ipcRenderer } from 'electron';

const NO_FOLDER = 'Select a folder first.';
const CLOSED = 'Folder session closed.';
const calls = debug('renderer:calls');

/** The open folder's worker, which the window calls directly; `null` until a folder opens. */
let worker: WorkerClient<PhotoWorkerAPI> | null = null;
const updateListeners = new Set<(update: LibraryUpdate) => void>();
const staleListeners = new Set<(entryIds: string[]) => void>();
const trashListeners = new Set<(progress: TrashProgress) => void>();

// Opening a folder brings a port to its worker, which replaces the last one's.
ipcRenderer.on(PHOTO_CHANNELS.worker, (event) => {
  const [port] = event.ports;
  if (!port) {
    return;
  }
  worker?.close(CLOSED);
  const client = new WorkerClient<PhotoWorkerAPI>((request) => port.postMessage(request), calls);
  port.addEventListener('message', (received: { data: unknown }) => {
    const data = received.data as WorkerResponse | WorkerEvent;
    if ('views' in data) {
      for (const listener of updateListeners) {
        listener(data);
      }
    } else if ('stale' in data) {
      for (const listener of staleListeners) {
        listener(data.stale);
      }
    } else if ('trashing' in data) {
      for (const listener of trashListeners) {
        listener(data.trashing);
      }
    } else {
      client.receive(data);
    }
  });
  // Electron's own event: the worker stopped, as the folder closed or another replaced it.
  port.addEventListener('close', () => client.close(CLOSED));
  port.start();
  worker = client;
});

function call<Method extends keyof PhotoWorkerAPI>(
  method: Method,
  ...args: Parameters<PhotoWorkerAPI[Method]>
) {
  return worker ? worker.call(method, ...args) : Promise.reject(new Error(NO_FOLDER));
}

/**
 * The photo API. Opening a folder brings a port to its worker, which the window then calls
 * directly; the main process only picks folders, shows menus and serves files. A window has
 * one, so what it keeps is this module's.
 */
export const photos: PhotosAPI = {
  closeFolder: async () => {
    worker?.close(CLOSED);
    worker = null;
    await ipcRenderer.invoke(PHOTO_CHANNELS.closeFolder);
  },
  closeView: (viewId) => call('closeView', viewId),
  currentFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.currentFolder),
  folderSkeleton: (parentIds) => call('folderSkeleton', parentIds),
  getOriginalURL: (entryId) => ipcRenderer.invoke(PHOTO_CHANNELS.getOriginalURL, entryId),
  listFolder: (directoryId) => call('listFolder', directoryId),
  onStale: (listener) => {
    staleListeners.add(listener);
    return () => staleListeners.delete(listener);
  },
  onUpdate: (listener) => {
    updateListeners.add(listener);
    return () => updateListeners.delete(listener);
  },
  openFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.openFolder),
  openView: (spec) => call('openView', spec),
  openedFolders: () => ipcRenderer.invoke(PHOTO_CHANNELS.openedFolders),
  // Failures are the user's to read, such as a photo on a disk that can't be changed.
  rateEntry: (entryId, rating) =>
    call('rate', entryId, rating).then(
      (entry) => ({ entry }),
      (error: unknown) => ({ error: errorMessage(error) }),
    ),
  readTiles: (directoryIds) => call('readTiles', directoryIds),
  refresh: () => call('refresh'),
  rememberCurrentFolder: (session, folderId) =>
    ipcRenderer.invoke(PHOTO_CHANNELS.rememberCurrentFolder, session, folderId),
  rememberOpenedFolders: (session, folders) =>
    ipcRenderer.invoke(PHOTO_CHANNELS.rememberOpenedFolders, session, folders),
  // Failures are the user's to read, such as a name already taken, so they come back as values.
  renameEntry: (entryId, name) =>
    call('rename', entryId, name).catch((error: unknown) => ({ error: errorMessage(error) })),
  // Thumbnails are background work, asked for by pages still reloading after their folder
  // closed, so failures come back as results rather than errors.
  requestThumbnail: (entryId) =>
    call('requestThumbnail', entryId).catch((error: unknown) => ({
      message: errorMessage(error),
      status: 'failed' as const,
    })),
  restoreFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.restoreFolder),
  showEntryMenu: (entryId, position) =>
    ipcRenderer.invoke(PHOTO_CHANNELS.showEntryMenu, entryId, position),
  storeThumbnail: (frame) =>
    call('storeThumbnail', frame).catch((error: unknown) => ({
      message: errorMessage(error),
      status: 'failed' as const,
    })),
  viewErrors: (viewId) => call('viewErrors', viewId),
  viewFacets: (viewId) => call('viewFacets', viewId),
  viewIndexOf: (viewId, version, entryId) => call('viewIndexOf', viewId, version, entryId),
  viewRows: (viewId, version, start, count) => call('viewRows', viewId, version, start, count),
};

/** Moving a view's matches to the Trash, over the same port to the folder's worker. */
export const trash: TrashAPI = {
  // Failures are the user's to read, such as a share gone offline, so they come back as values.
  deleteTrashBatch: (batchId) =>
    call('deleteTrashBatch', batchId).then(
      () => ({}),
      (error: unknown) => ({ error: errorMessage(error) }),
    ),
  emptyPrismTrash: () =>
    call('emptyPrismTrash').then(
      () => ({}),
      (error: unknown) => ({ error: errorMessage(error) }),
    ),
  onTrashProgress: (listener) => {
    trashListeners.add(listener);
    return () => trashListeners.delete(listener);
  },
  prismTrash: () => call('prismTrash'),
  prismTrashContents: (batchId) => call('prismTrashContents', batchId),
  putBackTrashBatch: (batchId) =>
    call('putBackTrashBatch', batchId).catch((error: unknown) => ({ error: errorMessage(error) })),
  trashPlace: () => call('trashPlace'),
  trashView: (viewId, version, choices, destination) =>
    call('trashView', viewId, version, choices, destination).catch((error: unknown) => ({
      error: errorMessage(error),
    })),
  undoTrash: (runId) =>
    call('undoTrash', runId).catch((error: unknown) => ({ error: errorMessage(error) })),
  viewTrashFiles: (viewId, version, choices) => call('viewTrashFiles', viewId, version, choices),
  viewTrashPlan: (viewId, version, choices) => call('viewTrashPlan', viewId, version, choices),
};
