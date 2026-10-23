import { openDefaultKeybindings, openKeybindings, startKeybindings } from '#keybindings';
import { createMenu } from '#menu';
import { registerPhotosAPI } from '#photos/ipc';
import { registerAppProtocol } from '#protocol';
import { startAutoUpdater } from '#updater';
import { createWindow } from '#window';
import { createKeymap } from '@app/keybindings';
import { PING_CHANNEL } from '@app/shared';
import { app, BrowserWindow, ipcMain, Menu, protocol } from 'electron';

const NO_WINDOWS = 0;

protocol.registerSchemesAsPrivileged([
  {
    privileges: { corsEnabled: true, secure: true, standard: true, supportFetchAPI: true },
    scheme: 'app'
  },
  {
    // Streaming lets videos play and seek before they have fully loaded.
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true
    },
    scheme: 'media'
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
  registerPhotosAPI();
  ipcMain.handle(PING_CHANNEL, () => 'pong');
  await startKeybindings((state) => {
    const keymap = createKeymap(process.platform, state.defaults, state.user);
    Menu.setApplicationMenu(
      createMenu(keymap, {
        openDefaults: () => openDefaultKeybindings().catch(() => null),
        openOwn: () => openKeybindings().catch(() => null)
      })
    );
  });
  createWindow();
  startAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === NO_WINDOWS) {
      createWindow();
    }
  });
}

startApplication();
