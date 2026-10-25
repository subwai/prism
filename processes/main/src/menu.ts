import { resetThumbnailCache } from '#photos/ipc';
import { type Command, keyFor, type Keymap, toAccelerator } from '@app/keybindings';
import { COMMAND_CHANNEL } from '@app/shared';
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

const SEPARATOR = { type: 'separator' } as const;

/**
 * The menu bar, showing the keys `keymap` gives its commands. The renderer handles those keys
 * itself, where it knows what has focus, so the menu only shows them and sends clicks on.
 */
export function createMenu(
  keymap: Keymap,
  keybindings: { openOwn: () => void; openDefaults: () => void }
) {
  function shortcut(name: Command) {
    const chord = keyFor(keymap, name);
    return chord ? toAccelerator(chord) : undefined;
  }
  /**
   * A menu item the renderer carries out. With `gesture`, the page may use web APIs that need
   * one, such as going full screen: a click in the native menu is no gesture to the page, so
   * an empty script run as one comes first.
   */
  function command(
    label: string,
    name: Command,
    { gesture = false } = {}
  ): MenuItemConstructorOptions {
    return {
      accelerator: shortcut(name),
      click: async (_item, window) => {
        if (!(window instanceof BrowserWindow)) {
          return;
        }
        if (gesture) {
          await window.webContents.executeJavaScript('', true);
        }
        window.webContents.send(COMMAND_CHANNEL, name);
      },
      label,
      registerAccelerator: false
    };
  }
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'File',
      submenu: [
        { ...command('Open Folder…', 'openFolder'), id: 'open-folder' },
        SEPARATOR,
        // Renames what is selected where focus is, as its right-click menu would.
        command('Rename…', 'rename'),
        SEPARATOR,
        { click: keybindings.openOwn, id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts…' },
        {
          click: keybindings.openDefaults,
          id: 'default-keyboard-shortcuts',
          label: 'Default Keyboard Shortcuts'
        },
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
        command('Find', 'find')
      ]
    },
    {
      label: 'View',
      submenu: [
        command('Refresh', 'refresh'),
        // The main process reloads the window, so this one key is the menu's own.
        { accelerator: shortcut('hardReload'), label: 'Hard Reload', role: 'forceReload' },
        SEPARATOR,
        { ...command('Switch Grid/Filmstrip', 'toggleView'), id: 'toggle-view' },
        SEPARATOR,
        command('Slideshow', 'slideshow'),
        SEPARATOR,
        command('Play/Pause Video', 'playPause'),
        command('Skip Back 5 Seconds', 'seekBackward'),
        command('Skip Forward 5 Seconds', 'seekForward'),
        command('Mute/Unmute Video', 'mute'),
        SEPARATOR,
        // The photo or video on its own; the window keeps the platform's own shortcut.
        {
          ...command('Full Screen Preview', 'fullScreen', { gesture: true }),
          id: 'full-screen'
        },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [SEPARATOR, { role: 'toggleDevTools' } as const])
      ]
    },
    {
      label: 'Go',
      submenu: [
        command('Back', 'back'),
        command('Forward', 'forward'),
        command('Enclosing Folder', 'up')
      ]
    },
    { role: 'windowMenu' }
  ];
  return Menu.buildFromTemplate(template);
}
