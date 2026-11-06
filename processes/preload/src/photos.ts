import {
  type FolderChanges,
  PHOTO_CHANNELS,
  type PhotosAPI,
  type PhotoWorkerAPI,
  WorkerClient,
  type WorkerEvent,
  type WorkerResponse,
} from '@prism/shared';
import { ipcRenderer } from 'electron';

const NO_FOLDER = 'Select a folder first.',
  CLOSED = 'Folder session closed.';

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The photo API. Opening a folder brings a port to its worker, which the window then calls
 * directly; the main process only picks folders, shows menus and serves files.
 */
export function createPhotosAPI(): PhotosAPI {
  let worker: WorkerClient<PhotoWorkerAPI> | null = null;
  const listeners = new Set<(changes: FolderChanges) => void>();

  ipcRenderer.on(PHOTO_CHANNELS.worker, (event) => {
    const [port] = event.ports;
    if (!port) {
      return;
    }
    worker?.close(CLOSED);
    const client = new WorkerClient<PhotoWorkerAPI>((request) => port.postMessage(request));
    port.addEventListener('message', (received: { data: unknown }) => {
      const data = received.data as WorkerResponse | WorkerEvent;
      if ('changes' in data) {
        for (const listener of listeners) {
          listener(data.changes);
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

  return {
    cancelScan: (scanId) => call('cancelScan', scanId),
    closeFolder: async () => {
      worker?.close(CLOSED);
      worker = null;
      await ipcRenderer.invoke(PHOTO_CHANNELS.closeFolder);
    },
    getOriginalURL: (entryId) => ipcRenderer.invoke(PHOTO_CHANNELS.getOriginalURL, entryId),
    inspectFolder: (directoryId) => call('inspectFolder', directoryId),
    nextBatch: (scanId) => call('nextBatch', scanId),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.openFolder),
    readMetadata: (entryIds) => call('readMetadata', entryIds),
    refresh: () => call('refresh'),
    // Failures are the user's to read, such as a name already taken, so they come back as values.
    renameEntry: (entryId, name) =>
      call('rename', entryId, name).catch((error: unknown) => ({ error: message(error) })),
    // Thumbnails are background work, asked for by pages still reloading after their folder
    // closed, so failures come back as results rather than errors.
    requestThumbnail: (entryId) =>
      call('requestThumbnail', entryId).catch((error: unknown) => ({
        message: message(error),
        status: 'failed' as const,
      })),
    restoreFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.restoreFolder),
    showEntryMenu: (entryId, position) =>
      ipcRenderer.invoke(PHOTO_CHANNELS.showEntryMenu, entryId, position),
    startScan: (options) => call('startScan', options),
    storeThumbnail: (frame) =>
      call('storeThumbnail', frame).catch((error: unknown) => ({
        message: message(error),
        status: 'failed' as const,
      })),
  };
}
