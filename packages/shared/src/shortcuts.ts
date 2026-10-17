/**
 * Keyboard shortcuts in Electron accelerator syntax, written for macOS; other platforms use
 * Ctrl wherever macOS uses Cmd. The menu registers them and tooltips show them, so both
 * always agree.
 */
export const SHORTCUTS = {
  actualSize: 'Shift+F',
  back: 'Cmd+[',
  close: 'Space',
  find: 'Cmd+F',
  forward: 'Cmd+]',
  fullScreen: 'Cmd+Shift+F',
  hardReload: 'Cmd+Shift+R',
  mute: 'Shift+M',
  openFolder: 'Cmd+O',
  playPause: 'Shift+Space',
  refresh: 'Cmd+R',
  seekBackward: 'Shift+Left',
  seekForward: 'Shift+Right',
  slideshow: 'Shift+S',
  toggleView: 'Cmd+G',
  up: 'Cmd+Up'
} as const;

export type ShortcutName = keyof typeof SHORTCUTS;

/** The accelerator for `name` on `platform`, a Node.js `process.platform` value. */
export function accelerator(name: ShortcutName, platform: string) {
  const shortcut = SHORTCUTS[name];
  return platform === 'darwin' ? shortcut : shortcut.replace('Cmd', 'Ctrl');
}

// macOS lists modifiers in this order, as symbols; elsewhere they are spelled out.
const MAC_MODIFIERS: Record<string, string> = { Alt: '⌥', Cmd: '⌘', Ctrl: '⌃', Shift: '⇧' };
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Cmd'];
const OTHER_ORDER = ['Ctrl', 'Alt', 'Shift'];
const KEYS: Record<string, string> = { Down: '↓', Left: '←', Right: '→', Up: '↑' };

/** How `name` is written on `platform`: `⇧⌘S` on macOS, `Ctrl+Shift+S` elsewhere. */
export function formatShortcut(name: ShortcutName, platform: string) {
  const mac = platform === 'darwin';
  const parts = accelerator(name, platform).split('+');
  const key = parts.at(-1) ?? '';
  const modifiers = (mac ? MAC_ORDER : OTHER_ORDER).filter((modifier) => parts.includes(modifier));
  const label = KEYS[key] ?? key;
  if (mac) {
    return [...modifiers.map((modifier) => MAC_MODIFIERS[modifier]), label].join('');
  }
  return [...modifiers, label].join('+');
}
