import { reopenWhereLeft } from '#window-state';
import { errorMessage, UPDATE_CHANNELS, type UpdateNotice } from '@prism/shared';
import { app, BrowserWindow } from 'electron';
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
 * Checks for an update and downloads it, calling `onChange` as it moves along. Returns a check
 * to run on request, which says what it found, as the startup check does not.
 */
export function startAutoUpdater(onChange: (state: UpdateState) => void): () => void {
  if (!app.isPackaged) {
    return () => {
      notify({ message: 'Development builds don’t check for updates.', warning: false });
    };
  }

  // The updater package is CommonJS; use its default export from this ESM entry.
  const { autoUpdater } = electronUpdater;
  let state: UpdateState = 'idle';
  function set(next: UpdateState) {
    state = next;
    onChange(next);
  }
  autoUpdater.on('checking-for-update', () => set('checking'));
  autoUpdater.on('update-available', () => set('downloading'));
  autoUpdater.on('update-not-available', () => set('idle'));
  autoUpdater.on('update-downloaded', () => set('ready'));
  autoUpdater.on('error', (error) => {
    reportUpdateError(error);
    if (state !== 'ready') {
      set('idle');
    }
  });
  autoUpdater.checkForUpdatesAndNotify().catch(() => null);

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
