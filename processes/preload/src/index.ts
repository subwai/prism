import { type AppAPI, PHOTO_CHANNELS, PING_CHANNEL } from '@app/shared';
import { contextBridge, ipcRenderer } from 'electron';

const api: AppAPI = {
  photos: {
    cancelScan: (scanId) => ipcRenderer.invoke(PHOTO_CHANNELS.cancelScan, scanId),
    cancelThumbnail: (requestId) => ipcRenderer.invoke(PHOTO_CHANNELS.cancelThumbnail, requestId),
    closeFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.closeFolder),
    getOriginalURL: (entryId) => ipcRenderer.invoke(PHOTO_CHANNELS.getOriginalURL, entryId),
    inspectFolder: (directoryId) => ipcRenderer.invoke(PHOTO_CHANNELS.inspectFolder, directoryId),
    nextBatch: (scanId) => ipcRenderer.invoke(PHOTO_CHANNELS.nextBatch, scanId),
    openFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.openFolder),
    requestThumbnail: (request) => ipcRenderer.invoke(PHOTO_CHANNELS.requestThumbnail, request),
    startScan: (options) => ipcRenderer.invoke(PHOTO_CHANNELS.startScan, options)
  },
  ping: () => ipcRenderer.invoke(PING_CHANNEL)
};

contextBridge.exposeInMainWorld('app', api);
