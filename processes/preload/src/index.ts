import {
  type AppAPI,
  type AppCommand,
  COMMAND_CHANNEL,
  PHOTO_CHANNELS,
  PING_CHANNEL
} from '@app/shared';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const api: AppAPI = {
  onCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: AppCommand) => listener(command);
    ipcRenderer.on(COMMAND_CHANNEL, handler);
    return () => ipcRenderer.removeListener(COMMAND_CHANNEL, handler);
  },
  photos: {
    cancelScan: (scanId) => ipcRenderer.invoke(PHOTO_CHANNELS.cancelScan, scanId),
    cancelThumbnail: (requestId) => ipcRenderer.invoke(PHOTO_CHANNELS.cancelThumbnail, requestId),
    closeFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.closeFolder),
    getOriginalURL: (entryId) => ipcRenderer.invoke(PHOTO_CHANNELS.getOriginalURL, entryId),
    inspectFolder: (directoryId) => ipcRenderer.invoke(PHOTO_CHANNELS.inspectFolder, directoryId),
    nextBatch: (scanId) => ipcRenderer.invoke(PHOTO_CHANNELS.nextBatch, scanId),
    openFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.openFolder),
    requestThumbnail: (request) => ipcRenderer.invoke(PHOTO_CHANNELS.requestThumbnail, request),
    restoreFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.restoreFolder),
    startScan: (options) => ipcRenderer.invoke(PHOTO_CHANNELS.startScan, options)
  },
  ping: () => ipcRenderer.invoke(PING_CHANNEL),
  platform: process.platform
};

contextBridge.exposeInMainWorld('app', api);
