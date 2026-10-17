import { accelerator, formatShortcut, type ShortcutName, SHORTCUTS } from '#shortcuts';
import { describe, expect, it } from 'vitest';

describe('shortcuts', () => {
  it('uses Ctrl where macOS uses Cmd', () => {
    expect(accelerator('refresh', 'darwin')).toBe('Cmd+R');
    expect(accelerator('refresh', 'win32')).toBe('Ctrl+R');
    expect(accelerator('fullScreen', 'linux')).toBe('Ctrl+Shift+F');
    expect(accelerator('actualSize', 'win32')).toBe('Shift+F');
  });

  it('writes shortcuts the way each platform does', () => {
    expect(formatShortcut('hardReload', 'darwin')).toBe('⇧⌘R');
    expect(formatShortcut('hardReload', 'win32')).toBe('Ctrl+Shift+R');
    expect(formatShortcut('slideshow', 'darwin')).toBe('⇧S');
    expect(formatShortcut('back', 'darwin')).toBe('⌘[');
    expect(formatShortcut('back', 'linux')).toBe('Ctrl+[');
    expect(formatShortcut('up', 'win32')).toBe('Ctrl+↑');
    expect(formatShortcut('up', 'darwin')).toBe('⌘↑');
    expect(formatShortcut('actualSize', 'darwin')).toBe('⇧F');
    expect(formatShortcut('close', 'win32')).toBe('Space');
    expect(formatShortcut('playPause', 'darwin')).toBe('⇧Space');
    expect(formatShortcut('seekBackward', 'darwin')).toBe('⇧←');
    expect(formatShortcut('seekForward', 'linux')).toBe('Shift+→');
  });

  it('never uses the Command key outside macOS', () => {
    for (const name of Object.keys(SHORTCUTS) as ShortcutName[]) {
      expect(accelerator(name, 'win32')).not.toMatch(/Cmd/u);
    }
  });
});
