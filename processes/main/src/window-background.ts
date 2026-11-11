import type { BrowserWindow } from 'electron';

/** Behind the transparent sidebar on platforms without vibrancy. */
export const WINDOW_BACKGROUND = '#262626';

/** On macOS, transparent pixels show the vibrancy material; the renderer paints everything else. */
export const MAC_BACKGROUND = { backgroundColor: '#00000000', vibrancy: 'sidebar' } as const;

/** Behind a photo, video or reader shown full screen, as the page paints it. */
const FULL_SCREEN_BACKGROUND = '#000000';

/**
 * Gives `window` a plain black background while what the page shows full screen covers it, or
 * its own back. macOS paints the background around the window as the window moves to a Space of
 * its own, and the page takes a moment to fill it once there; the material, which the color
 * cannot cover, looks there like a solid wash of the desktop's color.
 */
export function setFullScreenBackground(window: BrowserWindow, fullScreen: boolean): void {
  if (process.platform === 'darwin') {
    window.setVibrancy(fullScreen ? null : MAC_BACKGROUND.vibrancy);
    window.setBackgroundColor(fullScreen ? FULL_SCREEN_BACKGROUND : MAC_BACKGROUND.backgroundColor);
  } else {
    window.setBackgroundColor(fullScreen ? FULL_SCREEN_BACKGROUND : WINDOW_BACKGROUND);
  }
}
