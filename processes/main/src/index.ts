import { registerAppearanceAPI } from '#appearance';
import { installDevTools } from '#devtools';
import { openDefaultKeybindings, openKeybindings, startKeybindings } from '#keybindings';
import { createMenu } from '#menu';
import { registerPhotosAPI } from '#photos/ipc';
import { registerAppProtocol } from '#protocol';
import { installUpdate, startAutoUpdater } from '#updater';
import { createWindow } from '#window';
import { createKeymap, type Keymap } from '@prism/keybindings';
import { PING_CHANNEL } from '@prism/shared';
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
  registerAppearanceAPI();
  registerPhotosAPI();
  ipcMain.handle(PING_CHANNEL, () => 'pong');
  // Built again when the keybindings change, and once an update is ready to install.
  let keymap: Keymap | undefined,
    updateReady = false;
  function setMenu() {
    if (!keymap) {
      return;
    }
    Menu.setApplicationMenu(
      createMenu(
        keymap,
        {
          openDefaults: () => openDefaultKeybindings().catch(() => null),
          openOwn: () => openKeybindings().catch(() => null)
        },
        updateReady ? installUpdate : undefined
      )
    );
  }
  await startKeybindings((state) => {
    keymap = createKeymap(process.platform, state.defaults, state.user);
    setMenu();
  });
  await installDevTools();
  createWindow();
  startAutoUpdater(() => {
    updateReady = true;
    setMenu();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === NO_WINDOWS) {
      createWindow();
    }
  });
}

startApplication();
