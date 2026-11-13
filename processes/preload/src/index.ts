import { photos, trash } from '#photos';
import type { Command } from '@prism/keybindings';
import {
  type AppAPI,
  APPEARANCE_CHANNELS,
  COMMAND_CHANNEL,
  DEBUG_ARGUMENT,
  DEVELOPMENT_ARGUMENT,
  enableDebug,
  FULL_SCREEN_CHANNELS,
  KEYBINDING_CHANNELS,
  type KeybindingsState,
  UPDATE_CHANNELS,
  type UpdateNotice,
} from '@prism/shared';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// The sandbox hides the environment, so the main process passes `DEBUG` as an argument.
const debug =
  process.argv
    .find((argument) => argument.startsWith(DEBUG_ARGUMENT))
    ?.slice(DEBUG_ARGUMENT.length) ?? '';
enableDebug(debug);

const api: AppAPI = {
  appearance: {
    getAccentColor: () => ipcRenderer.invoke(APPEARANCE_CHANNELS.accentColor),
    onAccentColorChange: (listener) => {
      const handler = (_event: IpcRendererEvent, color: string | null) => listener(color);
      ipcRenderer.on(APPEARANCE_CHANNELS.accentColorChanged, handler);
      return () => ipcRenderer.removeListener(APPEARANCE_CHANNELS.accentColorChanged, handler);
    },
  },
  debug,
  development: process.argv.includes(DEVELOPMENT_ARGUMENT),
  fullScreen: {
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, fullScreen: boolean) => listener(fullScreen);
      ipcRenderer.on(FULL_SCREEN_CHANNELS.changed, handler);
      return () => ipcRenderer.removeListener(FULL_SCREEN_CHANNELS.changed, handler);
    },
    set: (fullScreen) => ipcRenderer.invoke(FULL_SCREEN_CHANNELS.set, fullScreen),
  },
  keybindings: {
    get: () => ipcRenderer.invoke(KEYBINDING_CHANNELS.get),
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, state: KeybindingsState) => listener(state);
      ipcRenderer.on(KEYBINDING_CHANNELS.changed, handler);
      return () => ipcRenderer.removeListener(KEYBINDING_CHANNELS.changed, handler);
    },
    open: () => ipcRenderer.invoke(KEYBINDING_CHANNELS.open),
  },
  onCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: Command) => listener(command);
    ipcRenderer.on(COMMAND_CHANNEL, handler);
    return () => ipcRenderer.removeListener(COMMAND_CHANNEL, handler);
  },
  photos,
  platform: process.platform,
  trash,
  updates: {
    install: () => ipcRenderer.invoke(UPDATE_CHANNELS.install),
    onNotice: (listener) => {
      const handler = (_event: IpcRendererEvent, notice: UpdateNotice) => listener(notice);
      ipcRenderer.on(UPDATE_CHANNELS.notice, handler);
      return () => ipcRenderer.removeListener(UPDATE_CHANNELS.notice, handler);
    },
    onReady: (listener) => {
      let listening = true;
      const handler = () => listener();
      ipcRenderer.on(UPDATE_CHANNELS.ready, handler);
      // An update may have downloaded before the window opened.
      ipcRenderer
        .invoke(UPDATE_CHANNELS.isReady)
        .then((ready: boolean) => {
          if (ready && listening) {
            listener();
          }
        })
        .catch(() => null);
      return () => {
        listening = false;
        ipcRenderer.removeListener(UPDATE_CHANNELS.ready, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('app', api);
