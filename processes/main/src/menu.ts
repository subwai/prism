import { resetThumbnailCache } from '#photos/ipc';
import { accelerator, type AppCommand, COMMAND_CHANNEL, type ShortcutName } from '@app/shared';
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

const SEPARATOR = { type: 'separator' } as const;

function shortcut(name: ShortcutName) {
  return accelerator(name, process.platform);
}

/** A menu item the renderer carries out, so it shows in the menu bar with its shortcut. */
function command(label: string, name: ShortcutName, issue: AppCommand): MenuItemConstructorOptions {
  return {
    accelerator: shortcut(name),
    click: (_item, window) => {
      if (window instanceof BrowserWindow) {
        window.webContents.send(COMMAND_CHANNEL, issue);
      }
    },
    label
  };
}

/** App-wide shortcuts live here; keys that act on what is focused stay in the renderer. */
export function createMenu() {
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'File',
      submenu: [
        command('Open Folder…', 'openFolder', 'open-folder'),
        SEPARATOR,
        {
          click: (_item, window) => {
            if (window instanceof BrowserWindow) {
              resetThumbnailCache(window).catch(() => null);
            }
          },
          id: 'reset-thumbnail-cache',
          label: 'Reset Thumbnail Cache'
        },
        SEPARATOR,
        mac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        SEPARATOR,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        SEPARATOR,
        command('Find', 'find', 'find')
      ]
    },
    {
      label: 'View',
      submenu: [
        command('Refresh', 'refresh', 'refresh'),
        { accelerator: shortcut('hardReload'), label: 'Hard Reload', role: 'forceReload' },
        SEPARATOR,
        // Shown, not registered: a bare Shift+key would swallow typing in the search field,
        // so the renderer listens for these outside text fields.
        { ...command('Slideshow', 'slideshow', 'slideshow'), registerAccelerator: false },
        SEPARATOR,
        { ...command('Play/Pause Video', 'playPause', 'play-pause'), registerAccelerator: false },
        {
          ...command('Skip Back 5 Seconds', 'seekBackward', 'seek-backward'),
          registerAccelerator: false
        },
        {
          ...command('Skip Forward 5 Seconds', 'seekForward', 'seek-forward'),
          registerAccelerator: false
        },
        SEPARATOR,
        { accelerator: shortcut('fullScreen'), role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [SEPARATOR, { role: 'toggleDevTools' } as const])
      ]
    },
    {
      label: 'Go',
      submenu: [
        command('Back', 'back', 'back'),
        command('Forward', 'forward', 'forward'),
        command('Enclosing Folder', 'up', 'up')
      ]
    },
    { role: 'windowMenu' }
  ];
  return Menu.buildFromTemplate(template);
}
