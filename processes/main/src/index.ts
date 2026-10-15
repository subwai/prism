import { registerAppProtocol } from '#protocol';
import { startAutoUpdater } from '#updater';
import { createWindow } from '#window';
import { PING_CHANNEL } from '@app/shared';
import { app, BrowserWindow, ipcMain, protocol } from 'electron';

const NO_WINDOWS = 0;

protocol.registerSchemesAsPrivileged([
  {
    privileges: { corsEnabled: true, secure: true, standard: true, supportFetchAPI: true },
    scheme: 'app'
  }
]);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Electron waits for entry-module evaluation before emitting ready.
async function startApplication(): Promise<void> {
  await app.whenReady();
  registerAppProtocol();
  ipcMain.handle(PING_CHANNEL, () => 'pong');
  createWindow();
  startAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === NO_WINDOWS) {
      createWindow();
    }
  });
}

startApplication();
