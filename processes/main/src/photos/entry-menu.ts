import { type BrowserWindow, Menu, shell } from 'electron';

// What each platform's file manager calls showing a file where it is.
const REVEAL_LABELS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'Reveal in Finder',
  win32: 'Reveal in File Explorer'
};

/**
 * The right-click menu for a photo, video or folder. `locate` finds it on disk when an item is
 * chosen, so the menu opens without waiting on the photo worker.
 */
export function popUpEntryMenu(window: BrowserWindow, locate: () => Promise<string>): void {
  Menu.buildFromTemplate([
    {
      click: () => {
        // A file deleted while the menu was open has nothing left to reveal.
        locate()
          .then((file) => shell.showItemInFolder(file))
          .catch(() => null);
      },
      label: REVEAL_LABELS[process.platform] ?? 'Open Containing Folder'
    }
  ]).popup({ window });
}
