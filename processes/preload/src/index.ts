import { listenOnChannel } from '#ipc-listeners';
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
import { contextBridge, ipcRenderer } from 'electron';

// The sandbox hides the environment, so the main process passes `DEBUG` as an argument.
const debug =
  process.argv
    .find((argument) => argument.startsWith(DEBUG_ARGUMENT))
    ?.slice(DEBUG_ARGUMENT.length) ?? '';
enableDebug(debug);

const api: AppAPI = {
  appearance: {
    getAccentColor: () => ipcRenderer.invoke(APPEARANCE_CHANNELS.accentColor),
    onAccentColorChange: (listener) =>
      listenOnChannel<string | null>(APPEARANCE_CHANNELS.accentColorChanged, listener),
  },
  debug,
  development: process.argv.includes(DEVELOPMENT_ARGUMENT),
  fullScreen: {
    onChange: (listener) => listenOnChannel<boolean>(FULL_SCREEN_CHANNELS.changed, listener),
    set: (fullScreen) => ipcRenderer.invoke(FULL_SCREEN_CHANNELS.set, fullScreen),
  },
  keybindings: {
    get: () => ipcRenderer.invoke(KEYBINDING_CHANNELS.get),
    onChange: (listener) =>
      listenOnChannel<KeybindingsState>(KEYBINDING_CHANNELS.changed, listener),
    open: () => ipcRenderer.invoke(KEYBINDING_CHANNELS.open),
  },
  onCommand: (listener) => listenOnChannel<Command>(COMMAND_CHANNEL, listener),
  photos,
  platform: process.platform,
  trash,
  updates: {
    install: () => ipcRenderer.invoke(UPDATE_CHANNELS.install),
    onNotice: (listener) => listenOnChannel<UpdateNotice>(UPDATE_CHANNELS.notice, listener),
    onReady: (listener) => {
      let listening = true;
      const stopListening = listenOnChannel(UPDATE_CHANNELS.ready, () => listener());
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
        stopListening();
      };
    },
  },
};

contextBridge.exposeInMainWorld('app', api);
