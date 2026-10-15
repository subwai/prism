import { type AppAPI, PING_CHANNEL } from '@app/shared';
import { contextBridge, ipcRenderer } from 'electron';

const api: AppAPI = {
  ping: () => ipcRenderer.invoke(PING_CHANNEL)
};

contextBridge.exposeInMainWorld('app', api);
