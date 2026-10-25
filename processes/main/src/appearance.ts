import { APPEARANCE_CHANNELS } from '@prism/shared';
import { BrowserWindow, ipcMain, systemPreferences } from 'electron';

/**
 * The system's accent colour as CSS colour text, or `null` where the platform has none to give,
 * to keep the app's own. On macOS under Multicolor this is the system's blue.
 */
function accentColor(): string | null {
  try {
    const color = systemPreferences.getAccentColor();
    // RRGGBBAA, as Electron gives it on every platform that has one.
    return /^[\da-f]{8}$/iu.test(color) ? `#${color}` : null;
  } catch {
    return null;
  }
}

function broadcast() {
  const color = accentColor();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(APPEARANCE_CHANNELS.accentColorChanged, color);
  }
}

/** Gives the renderer the system's accent colour, and tells it when the user changes it. */
export function registerAppearanceAPI(): void {
  ipcMain.handle(APPEARANCE_CHANNELS.accentColor, accentColor);
  if (process.platform === 'darwin') {
    systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', broadcast);
  } else {
    systemPreferences.on('accent-color-changed', broadcast);
  }
}
