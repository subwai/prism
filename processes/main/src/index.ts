import { registerAppearanceAPI } from '#appearance';
import { installDevTools } from '#devtools';
import { registerFullScreenAPI } from '#full-screen';
import { openDefaultKeybindings, openKeybindings, startKeybindings } from '#keybindings';
import { createMenu } from '#menu';
import { registerPhotosAPI } from '#photos/main/ipc';
import { keepCachesTidy } from '#photos/main/stale-caches';
import { upkeepThumbnails } from '#photos/main/thumbnail-directory';
import { registerAppProtocol } from '#protocol';
import { installUpdate, startAutoUpdater, type UpdateState } from '#updater';
import { createWindow } from '#window';
import { createKeymap, type Keymap } from '@prism/keybindings';
import { APP_NAME } from '@prism/shared';
import { app, BrowserWindow, Menu, protocol } from 'electron';
import path from 'node:path';

const NO_WINDOWS = 0;

// A development build keeps its data in a folder of its own, which every checkout shares,
// rather than in the installed app's: Electron names the folder after the package, and on
// macOS and Windows `prism` and `Prism` are the same folder. Tests launch it with a profile of
// their own, which stays. It must be set before anything uses the folder.
if (
  !app.isPackaged &&
  !app.commandLine.hasSwitch('user-data-dir') &&
  !process.argv.some((argument) => argument.startsWith('--user-data-dir'))
) {
  app.setPath('userData', path.join(app.getPath('appData'), `${APP_NAME} Development`));
}

protocol.registerSchemesAsPrivileged([
  {
    privileges: { corsEnabled: true, secure: true, standard: true, supportFetchAPI: true },
    scheme: 'app',
  },
  {
    // Streaming lets videos play and seek before they have fully loaded.
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: 'media',
  },
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
  registerFullScreenAPI();
  registerPhotosAPI();
  keepCachesTidy();
  upkeepThumbnails();
  // Built again when the keybindings change, and as an update is checked for and downloaded.
  let keymap: Keymap | undefined;
  let updateState: UpdateState = 'idle';
  const checkForUpdates = startAutoUpdater((state) => {
    updateState = state;
    setMenu();
  });
  function setMenu() {
    if (!keymap) {
      return;
    }
    Menu.setApplicationMenu(
      createMenu(
        keymap,
        {
          openDefaults: () => openDefaultKeybindings().catch(() => null),
          openOwn: () => openKeybindings().catch(() => null),
        },
        { check: checkForUpdates, install: installUpdate, state: updateState },
      ),
    );
  }
  await startKeybindings((state) => {
    keymap = createKeymap(process.platform, state.defaults, state.user);
    setMenu();
  });
  await installDevTools();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === NO_WINDOWS) {
      createWindow();
    }
  });
}

startApplication();
