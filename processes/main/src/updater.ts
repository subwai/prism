import { errorMessage } from '@prism/shared';
import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';

/** Where an update stands: none in hand, being looked for, downloading, or waiting to install. */
export type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready';

function reportUpdateError(error: unknown): void {
  process.stderr.write(`Auto-update failed: ${String(error)}\n`);
}

/**
 * Checks for an update and downloads it, calling `onChange` as it moves along. Returns a check
 * to run on request, which says what it found, as the startup check does not.
 */
export function startAutoUpdater(onChange: (state: UpdateState) => void): () => void {
  if (!app.isPackaged) {
    return () => {
      dialog.showMessageBox({
        detail: 'Install a release build to receive updates.',
        message: 'Development builds don’t check for updates.',
      });
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
      const version = result?.updateInfo.version;
      await dialog.showMessageBox(
        result?.isUpdateAvailable
          ? {
              detail:
                'It is downloading, and the menu will offer to restart into it once it is ready.',
              message: `${app.name} ${version} is available.`,
            }
          : {
              detail: `${app.name} ${app.getVersion()} is the newest version available.`,
              message: 'You’re up to date.',
            },
      );
    } catch (error) {
      await dialog.showMessageBox({
        detail: errorMessage(error),
        message: 'Couldn’t check for updates.',
        type: 'warning',
      });
    }
  };
}

/** Quits, installs the downloaded update and opens it. */
export function installUpdate(): void {
  electronUpdater.autoUpdater.quitAndInstall();
}
