import { resetPhotoIndex } from '#photos/index-file';
import { resetThumbnailCache } from '#photos/thumbnail-directory';
import { type Command, keyFor, type Keymap, toAccelerator } from '@prism/keybindings';
import { COMMAND_CHANNEL } from '@prism/shared';
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

const SEPARATOR = { type: 'separator' } as const;

/**
 * The menu bar, showing the keys `keymap` gives its commands. The renderer handles those keys
 * itself, where it knows what has focus, so the menu only shows them and sends clicks on.
 * With `installUpdate`, a downloaded update is waiting, and the menu offers to restart into it.
 */
export function createMenu(
  keymap: Keymap,
  keybindings: { openOwn: () => void; openDefaults: () => void },
  installUpdate?: () => void,
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
    { gesture = false } = {},
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
      registerAccelerator: false,
    };
  }
  const mac = process.platform === 'darwin';
  // macOS 14 and up show the badge as "1 Update" beside the item; other systems show none.
  const update: MenuItemConstructorOptions[] = installUpdate
    ? [
        {
          badge: { count: 1, type: 'updates' },
          click: installUpdate,
          id: 'install-update',
          label: 'Restart to Update',
        },
      ]
    : [];
  const template: MenuItemConstructorOptions[] = [
    // The `appMenu` role's items, with the update after About as Mac apps place it.
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              ...update,
              SEPARATOR,
              { role: 'services' },
              SEPARATOR,
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              SEPARATOR,
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
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
          label: 'Default Keyboard Shortcuts',
        },
        SEPARATOR,
        {
          click: (_item, window) => {
            if (window instanceof BrowserWindow) {
              resetThumbnailCache(window).catch(() => null);
            }
          },
          id: 'reset-thumbnail-cache',
          label: 'Reset Thumbnail Cache',
        },
        {
          // For edits the index cannot tell apart, by tools that keep a file's modified time.
          click: (_item, window) => {
            if (window instanceof BrowserWindow) {
              resetPhotoIndex(window);
            }
          },
          id: 'reset-photo-index',
          label: 'Reset Photo Details',
        },
        SEPARATOR,
        ...(mac ? [] : update),
        mac ? { role: 'close' } : { role: 'quit' },
      ],
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
        command('Find', 'find'),
      ],
    },
    {
      label: 'View',
      submenu: [
        command('Refresh', 'refresh'),
        // The main process reloads the window, so this one key is the menu's own.
        { accelerator: shortcut('hardReload'), label: 'Hard Reload', role: 'forceReload' },
        SEPARATOR,
        { ...command('Switch View', 'toggleView'), id: 'toggle-view' },
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
          id: 'full-screen',
        },
        { role: 'togglefullscreen' },
        ...(app.isPackaged
          ? []
          : [
              SEPARATOR,
              { role: 'toggleDevTools' } as const,
              {
                // The catalog of the design system's tokens and components, for development.
                click: (_item, window) => {
                  if (window instanceof BrowserWindow) {
                    const page = new URL('/design-system', window.webContents.getURL());
                    window.webContents.loadURL(page.href);
                  }
                },
                label: 'Design System',
              } satisfies MenuItemConstructorOptions,
            ]),
      ],
    },
    {
      label: 'Go',
      submenu: [
        command('Back', 'back'),
        command('Forward', 'forward'),
        command('Enclosing Folder', 'up'),
      ],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}
