import { addListener, listenOnChannel } from '#ipc-listeners';
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
import { ipcRenderer } from 'electron';

const NO_FOLDER = 'Select a folder first.';
const CLOSED = 'Folder session closed.';
const callLog = debug('renderer:calls');

/** The library worker, which the window calls directly; `null` until a folder opens. */
let worker: WorkerClient<PhotoWorkerAPI> | null = null;
const updateListeners = new Set<(update: LibraryUpdate) => void>();
const staleListeners = new Set<(entryIds: string[]) => void>();
const thumbnailListeners = new Set<(update: ThumbnailUpdate) => void>();
const trashListeners = new Set<(progress: TrashProgress) => void>();
const activityListeners = new Set<(activity: Activity) => void>();
/**
 * What the worker last reported it is busy with. It reports again only when that changes, so
 * a new listener is given this at once.
 */
let activity: Activity | null = null;

/** Calls each of `listeners` with `value`. */
function callEach<Value>(listeners: Set<(value: Value) => void>, value: Value) {
  for (const listener of listeners) {
    listener(value);
  }
}

// Opening a folder brings a port to its worker, which replaces the last one's.
ipcRenderer.on(PHOTO_CHANNELS.worker, (event) => {
  const [port] = event.ports;
  if (!port) {
    return;
  }
  worker?.close(CLOSED);
  activity = null;
  const client = new WorkerClient<PhotoWorkerAPI>((request) => port.postMessage(request), callLog);
  port.addEventListener('message', (received: { data: unknown }) => {
    const data = received.data as WorkerResponse | WorkerEvent;
    switch (data.kind) {
      case 'update': {
        callEach(updateListeners, data.update);
        break;
      }
      case 'stale': {
        callEach(staleListeners, data.entryIds);
        break;
      }
      case 'thumbnail': {
        callEach(thumbnailListeners, data.thumbnail);
        break;
      }
      case 'trashProgress': {
        callEach(trashListeners, data.progress);
        break;
      }
      case 'activity': {
        ({ activity } = data);
        callEach(activityListeners, data.activity);
        break;
      }
      // The rest are responses to calls.
      default: {
        client.receive(data);
      }
    }
  });
  // Electron's own event: the worker stopped, as the folder closed or another replaced it.
  port.addEventListener('close', () => client.close(CLOSED));
  port.start();
  worker = client;
});

/** What a call that returns nothing gives the window once it succeeds. */
function done() {
  return { kind: 'done' as const };
}

/** What a failed call gives the window, which shows the message to the user. */
function failed(error: unknown) {
  return { error: errorMessage(error), kind: 'failed' as const };
}

function call<Method extends keyof PhotoWorkerAPI>(
  method: Method,
  ...args: Parameters<PhotoWorkerAPI[Method]>
) {
  return worker ? worker.call(method, ...args) : Promise.reject(new Error(NO_FOLDER));
}

/**
 * The photo API. Opening a folder brings a port to its worker, which the window then calls
 * directly; the main process only picks folders, shows menus and serves files. Each window
 * has one photo API, so its state lives in this module.
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
    return addListener(activityListeners, listener);
  },
  onStale: (listener) => addListener(staleListeners, listener),
  onThumbnail: (listener) => addListener(thumbnailListeners, listener),
  onUpdate: (listener) => addListener(updateListeners, listener),
  onUpgrading: (listener) => listenOnChannel<boolean>(PHOTO_CHANNELS.upgrading, listener),
  openFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.openFolder),
  openView: (spec) => call('openView', spec),
  openedFolders: () => ipcRenderer.invoke(PHOTO_CHANNELS.openedFolders),
  // Failures are the user's to read, such as a photo on a disk that can't be changed.
  rateEntry: (entryId, rating) =>
    call('rate', entryId, rating).then((entry) => ({ entry, kind: 'rated' as const }), failed),
  refresh: () => call('refresh'),
  rememberCurrentFolder: (session, folderId) =>
    ipcRenderer.invoke(PHOTO_CHANNELS.rememberCurrentFolder, session, folderId),
  rememberOpenedFolders: (session, folders) =>
    ipcRenderer.invoke(PHOTO_CHANNELS.rememberOpenedFolders, session, folders),
  // Failures are the user's to read, such as a name already taken, so they come back as values.
  renameEntry: (entryId, name) =>
    call('rename', entryId, name).then(
      ({ changes, entry }) => ({ changes, entry, kind: 'renamed' as const }),
      failed,
    ),
  reportScreenContents: (contents) => call('reportScreenContents', contents),
  restoreFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.restoreFolder),
  showEntryMenu: (entryId, position) =>
    ipcRenderer.invoke(PHOTO_CHANNELS.showEntryMenu, entryId, position),
  // A still image stored as the folder closes comes back as a failed result, which the tile shows,
  // rather than as an error.
  storeThumbnail: (stillImage) =>
    call('storeThumbnail', stillImage).catch((error: unknown) => ({
      message: errorMessage(error),
      status: 'failed' as const,
    })),
  viewErrors: (viewId) => call('viewErrors', viewId),
  viewFacets: (viewId) => call('viewFacets', viewId),
  viewIndexOf: (viewId, version, entryId) => call('viewIndexOf', viewId, version, entryId),
  viewRows: (viewId, version, start, count) => call('viewRows', viewId, version, start, count),
};

/** Moving a view's matches to the Trash, over the same port to the library worker. */
export const trash: TrashAPI = {
  // Failures are the user's to read, such as a share gone offline, so they come back as values.
  deleteTrashBatch: (batchId) => call('deleteTrashBatch', batchId).then(done, failed),
  emptyPrismTrash: () => call('emptyPrismTrash').then(done, failed),
  getTrashLocation: () => call('getTrashLocation'),
  onTrashProgress: (listener) => addListener(trashListeners, listener),
  prismTrash: () => call('prismTrash'),
  prismTrashContents: (batchId) => call('prismTrashContents', batchId),
  putBackTrashBatch: (batchId) =>
    call('putBackTrashBatch', batchId).then(
      (summary) => ({ ...summary, kind: 'undone' as const }),
      failed,
    ),
  trashView: (viewId, version, choices, destination) =>
    call('trashView', viewId, version, choices, destination).then(
      (summary) => ({ ...summary, kind: 'ran' as const }),
      failed,
    ),
  undoTrash: (runId) =>
    call('undoTrash', runId).then((summary) => ({ ...summary, kind: 'undone' as const }), failed),
  viewTrashFiles: (viewId, version, choices) => call('viewTrashFiles', viewId, version, choices),
  viewTrashPlan: (viewId, version, choices) => call('viewTrashPlan', viewId, version, choices),
};
