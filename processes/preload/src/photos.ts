import {
  type Activity,
  debug,
  errorMessage,
  type LibraryUpdate,
  PHOTO_CHANNELS,
  type PhotosAPI,
  type PhotoWorkerAPI,
  type ThumbnailUpdate,
  type TrashAPI,
  type TrashProgress,
  WorkerClient,
  type WorkerEvent,
  type WorkerResponse,
} from '@prism/shared';
import { ipcRenderer, type IpcRendererEvent } from 'electron';

const NO_FOLDER = 'Select a folder first.';
const CLOSED = 'Folder session closed.';
const calls = debug('renderer:calls');

/** The open folder's worker, which the window calls directly; `null` until a folder opens. */
let worker: WorkerClient<PhotoWorkerAPI> | null = null;
const updateListeners = new Set<(update: LibraryUpdate) => void>();
const staleListeners = new Set<(entryIds: string[]) => void>();
const thumbnailListeners = new Set<(update: ThumbnailUpdate) => void>();
const trashListeners = new Set<(progress: TrashProgress) => void>();
const activityListeners = new Set<(activity: Activity) => void>();
/** What the worker last said it is busy with, which it says again only once it changes. */
let activity: Activity | null = null;

// Opening a folder brings a port to its worker, which replaces the last one's.
ipcRenderer.on(PHOTO_CHANNELS.worker, (event) => {
  const [port] = event.ports;
  if (!port) {
    return;
  }
  worker?.close(CLOSED);
  activity = null;
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
    } else if ('thumbnail' in data) {
      for (const listener of thumbnailListeners) {
        listener(data.thumbnail);
      }
    } else if ('trashing' in data) {
      for (const listener of trashListeners) {
        listener(data.trashing);
      }
    } else if ('activity' in data) {
      ({ activity } = data);
      for (const listener of activityListeners) {
        listener(data.activity);
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
  getOriginalURL: (entryId) => ipcRenderer.invoke(PHOTO_CHANNELS.getOriginalURL, entryId),
  listFolder: (directoryId) => call('listFolder', directoryId),
  listFoldersById: (folderIds) => call('listFoldersById', folderIds),
  listSubfolders: (parentIds) => call('listSubfolders', parentIds),
  listWholeTree: () => call('listWholeTree'),
  onActivity: (listener) => {
    if (activity) {
      listener(activity);
    }
    activityListeners.add(listener);
    return () => activityListeners.delete(listener);
  },
  onStale: (listener) => {
    staleListeners.add(listener);
    return () => staleListeners.delete(listener);
  },
  onThumbnail: (listener) => {
    thumbnailListeners.add(listener);
    return () => thumbnailListeners.delete(listener);
  },
  onUpdate: (listener) => {
    updateListeners.add(listener);
    return () => updateListeners.delete(listener);
  },
  onUpgrading: (listener) => {
    const handler = (_event: IpcRendererEvent, upgrading: boolean) => listener(upgrading);
    ipcRenderer.on(PHOTO_CHANNELS.upgrading, handler);
    return () => ipcRenderer.removeListener(PHOTO_CHANNELS.upgrading, handler);
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
  refresh: () => call('refresh'),
  rememberCurrentFolder: (session, folderId) =>
    ipcRenderer.invoke(PHOTO_CHANNELS.rememberCurrentFolder, session, folderId),
  rememberOpenedFolders: (session, folders) =>
    ipcRenderer.invoke(PHOTO_CHANNELS.rememberOpenedFolders, session, folders),
  // Failures are the user's to read, such as a name already taken, so they come back as values.
  renameEntry: (entryId, name) =>
    call('rename', entryId, name).catch((error: unknown) => ({ error: errorMessage(error) })),
  reportScreenContents: (contents) => call('reportScreenContents', contents),
  restoreFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.restoreFolder),
  showEntryMenu: (entryId, position) =>
    ipcRenderer.invoke(PHOTO_CHANNELS.showEntryMenu, entryId, position),
  // A still taken as the folder closes fails as a result, as the tile shows it.
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
  getTrashLocation: () => call('getTrashLocation'),
  onTrashProgress: (listener) => {
    trashListeners.add(listener);
    return () => trashListeners.delete(listener);
  },
  prismTrash: () => call('prismTrash'),
  prismTrashContents: (batchId) => call('prismTrashContents', batchId),
  putBackTrashBatch: (batchId) =>
    call('putBackTrashBatch', batchId).catch((error: unknown) => ({ error: errorMessage(error) })),
  trashView: (viewId, version, choices, destination) =>
    call('trashView', viewId, version, choices, destination).catch((error: unknown) => ({
      error: errorMessage(error),
    })),
  undoTrash: (runId) =>
    call('undoTrash', runId).catch((error: unknown) => ({ error: errorMessage(error) })),
  viewTrashFiles: (viewId, version, choices) => call('viewTrashFiles', viewId, version, choices),
  viewTrashPlan: (viewId, version, choices) => call('viewTrashPlan', viewId, version, choices),
};
