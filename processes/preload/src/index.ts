import type { Command } from '@prism/keybindings';
import {
  type AppAPI,
  APPEARANCE_CHANNELS,
  COMMAND_CHANNEL,
  type FolderChanges,
  KEYBINDING_CHANNELS,
  type KeybindingsState,
  PHOTO_CHANNELS,
  PING_CHANNEL
} from '@prism/shared';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const api: AppAPI = {
  appearance: {
    getAccentColor: () => ipcRenderer.invoke(APPEARANCE_CHANNELS.accentColor),
    onAccentColorChange: (listener) => {
      const handler = (_event: IpcRendererEvent, color: string | null) => listener(color);
      ipcRenderer.on(APPEARANCE_CHANNELS.accentColorChanged, handler);
      return () => ipcRenderer.removeListener(APPEARANCE_CHANNELS.accentColorChanged, handler);
    }
  },
  keybindings: {
    get: () => ipcRenderer.invoke(KEYBINDING_CHANNELS.get),
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: KeybindingsState) => listener(state);
      ipcRenderer.on(KEYBINDING_CHANNELS.changed, handler);
      return () => ipcRenderer.removeListener(KEYBINDING_CHANNELS.changed, handler);
    },
    open: () => ipcRenderer.invoke(KEYBINDING_CHANNELS.open)
  },
  onCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: Command) => listener(command);
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
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, changes: FolderChanges) => listener(changes);
      ipcRenderer.on(PHOTO_CHANNELS.changed, handler);
      return () => ipcRenderer.removeListener(PHOTO_CHANNELS.changed, handler);
    },
    openFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.openFolder),
    renameEntry: (entryId, name) => ipcRenderer.invoke(PHOTO_CHANNELS.renameEntry, entryId, name),
    requestThumbnail: (request) => ipcRenderer.invoke(PHOTO_CHANNELS.requestThumbnail, request),
    restoreFolder: () => ipcRenderer.invoke(PHOTO_CHANNELS.restoreFolder),
    showEntryMenu: (entryId, position) =>
      ipcRenderer.invoke(PHOTO_CHANNELS.showEntryMenu, entryId, position),
    startScan: (options) => ipcRenderer.invoke(PHOTO_CHANNELS.startScan, options),
    storeThumbnail: (frame) => ipcRenderer.invoke(PHOTO_CHANNELS.storeThumbnail, frame)
  },
  ping: () => ipcRenderer.invoke(PING_CHANNEL),
  platform: process.platform
};

contextBridge.exposeInMainWorld('app', api);
