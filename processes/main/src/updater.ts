import { app } from 'electron';
import electronUpdater from 'electron-updater';

function reportUpdateError(error: unknown): void {
  process.stderr.write(`Auto-update failed: ${String(error)}\n`);
}

export function startAutoUpdater(): void {
  if (!app.isPackaged) {
    return;
  }

  // The updater package is CommonJS; use its default export from this ESM entry.
  const { autoUpdater } = electronUpdater;
  autoUpdater.checkForUpdatesAndNotify().catch(reportUpdateError);
}
