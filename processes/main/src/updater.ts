import { app } from 'electron';
import electronUpdater from 'electron-updater';

function reportUpdateError(error: unknown): void {
  process.stderr.write(`Auto-update failed: ${String(error)}\n`);
}

/** Checks for an update and downloads it, calling `onReady` once it is waiting to install. */
export function startAutoUpdater(onReady: () => void): void {
  if (!app.isPackaged) {
    return;
  }

  // The updater package is CommonJS; use its default export from this ESM entry.
  const { autoUpdater } = electronUpdater;
  autoUpdater.once('update-downloaded', onReady);
  autoUpdater.checkForUpdatesAndNotify().catch(reportUpdateError);
}

/** Quits, installs the downloaded update and opens it. */
export function installUpdate(): void {
  electronUpdater.autoUpdater.quitAndInstall();
}
