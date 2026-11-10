import type { EntryMenuAction, MenuPosition } from '@prism/shared';
import { type BrowserWindow, clipboard, Menu, shell } from 'electron';

// What each platform's file manager calls showing a file where it is.
const REVEAL_LABELS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'Reveal in Finder',
  win32: 'Reveal in File Explorer',
};

/**
 * The right-click menu for a photo, video or folder. `locate` finds it on disk when an item is
 * chosen, so the menu opens without waiting on the photo worker. Resolves when the menu closes,
 * with the action left to the window, if one was chosen; `renamable` offers renaming. It opens
 * at `position` in the window if given, and at the pointer otherwise.
 */
export function popUpEntryMenu(
  window: BrowserWindow,
  locate: () => Promise<string>,
  renamable: boolean,
  position?: MenuPosition,
): Promise<EntryMenuAction | null> {
  const chosen = Promise.withResolvers<EntryMenuAction | null>();
  Menu.buildFromTemplate([
    ...(renamable
      ? [
          { click: () => chosen.resolve('rename'), label: 'Rename…' },
          { type: 'separator' } as const,
        ]
      : []),
    {
      click: () => {
        // A file deleted while the menu was open has nothing left to reveal.
        locate()
          .then((file) => shell.showItemInFolder(file))
          .catch(() => null);
      },
      label: REVEAL_LABELS[process.platform] ?? 'Open Containing Folder',
    },
    {
      click: () => {
        locate()
          .then((file) => clipboard.writeText(file))
          .catch(() => null);
      },
      label: 'Copy Path',
    },
  ]).popup({
    // The menu can report closing before the chosen item's click runs, so wait a turn.
    callback: () => setImmediate(() => chosen.resolve(null)),
    window,
    // oxlint-disable-next-line id-length -- Electron's menus take x and y.
    ...(position && { x: Math.round(position.left), y: Math.round(position.top) }),
  });
  return chosen.promise;
}
