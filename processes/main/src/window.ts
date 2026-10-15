import { APP_NAME } from '@app/shared';
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

const WINDOW_HEIGHT = 780,
  WINDOW_WIDTH = 1180;

export function createWindow(): void {
  const window = new BrowserWindow({
    backgroundColor: '#151515',
    height: WINDOW_HEIGHT,
    minHeight: 520,
    minWidth: 740,
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true
    },
    width: WINDOW_WIDTH
  });
  let rendererURL = 'app://app/';
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    rendererURL = process.env.ELECTRON_RENDERER_URL;
  }

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = new URL(rendererURL),
      destination = new URL(url);
    if (destination.protocol !== allowed.protocol || destination.host !== allowed.host) {
      event.preventDefault();
    }
  });

  window.loadURL(rendererURL);
}
