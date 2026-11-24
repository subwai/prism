import { ipcRenderer, type IpcRendererEvent } from 'electron';

/** Calls `listener` with each value the main process sends on `channel`, until unsubscribed. */
export function listenOnChannel<Value>(
  channel: string,
  listener: (value: Value) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, value: Value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
