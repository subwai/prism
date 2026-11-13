import { reopenWhereLeft } from '#window-state';
import { errorMessage, UPDATE_CHANNELS, type UpdateNotice } from '@prism/shared';
import { app, BrowserWindow, ipcMain } from 'electron';
import electronUpdater from 'electron-updater';

/** Where an update stands: none in hand, being looked for, downloading, or waiting to install. */
export type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready';

function reportUpdateError(error: unknown): void {
  process.stderr.write(`Auto-update failed: ${String(error)}\n`);
}

/** Tells the windows what a check found, which they show for a moment. */
function notify(notice: UpdateNotice): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(UPDATE_CHANNELS.notice, notice);
  }
}

/**
 * Checks for an update and downloads it, calling `onChange` as it moves along, and tells the
 * windows once it has, so they can offer to restart. Returns a check to run on request, which
 * says what it found, as the startup check does not.
 */
export function startAutoUpdater(onChange: (state: UpdateState) => void): () => void {
  let state: UpdateState = 'idle';
  ipcMain.handle(UPDATE_CHANNELS.isReady, () => state === 'ready');
  ipcMain.handle(UPDATE_CHANNELS.install, () => {
    if (state === 'ready') {
      installUpdate();
    }
  });
  if (!app.isPackaged) {
    return () => {
      notify({ message: 'Development builds don’t check for updates.', warning: false });
    };
  }

  // The updater package is CommonJS; use its default export from this ESM entry.
  const { autoUpdater } = electronUpdater;
  function set(next: UpdateState) {
    state = next;
    onChange(next);
  }
  autoUpdater.on('checking-for-update', () => set('checking'));
  autoUpdater.on('update-available', () => set('downloading'));
  autoUpdater.on('update-not-available', () => set('idle'));
  autoUpdater.on('update-downloaded', () => {
    set('ready');
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(UPDATE_CHANNELS.ready);
    }
  });
  autoUpdater.on('error', (error) => {
    reportUpdateError(error);
    if (state !== 'ready') {
      set('idle');
    }
  });
  // The window offers to restart once the update has downloaded, so no system notification.
  autoUpdater.checkForUpdates().catch(() => null);

  return async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      notify({
        message: result?.isUpdateAvailable
          ? `Downloading ${app.name} ${result.updateInfo.version}. Restart to update once it’s ready.`
          : `You’re up to date: ${app.name} ${app.getVersion()} is the newest version.`,
        warning: false,
      });
    } catch (error) {
      notify({ message: `Couldn’t check for updates: ${errorMessage(error)}`, warning: true });
    }
  };
}

/** Quits, installs the downloaded update and opens it, on the page the window showed. */
export function installUpdate(): void {
  reopenWhereLeft();
  electronUpdater.autoUpdater.quitAndInstall();
}
