import { createPhotosAPI } from '#photos';
import type { Command } from '@prism/keybindings';
import {
  type AppAPI,
  APPEARANCE_CHANNELS,
  COMMAND_CHANNEL,
  DEVELOPMENT_ARGUMENT,
  KEYBINDING_CHANNELS,
  type KeybindingsState
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
  development: process.argv.includes(DEVELOPMENT_ARGUMENT),
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
  photos: createPhotosAPI(),
  platform: process.platform
};

contextBridge.exposeInMainWorld('app', api);
