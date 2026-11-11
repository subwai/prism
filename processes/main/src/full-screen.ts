import { setFullScreenBackground } from '#window-background';
import { FULL_SCREEN_CHANNELS } from '@prism/shared';
import { BrowserWindow, ipcMain } from 'electron';
import { once } from 'node:events';

/** Longer than the window's own transition, in case it never says it has finished. */
const TRANSITION_TIMEOUT = 2000;

/** Windows the page took into or out of full screen itself, which needs no telling. */
const asked = new WeakSet<BrowserWindow>();

/**
 * Takes `window` full screen, in a Space of its own on macOS, or out of it, resolving once the
 * window's transition has finished to whether this changed it.
 */
async function setFullScreen(window: BrowserWindow, fullScreen: boolean) {
  if (window.isFullScreen() === fullScreen) {
    return false;
  }
  asked.add(window);
  // The page covers the window from just before it goes full screen until just after it is
  // back, so the background changes unseen.
  if (fullScreen) {
    setFullScreenBackground(window, true);
  }
  const finished = once(window, fullScreen ? 'enter-full-screen' : 'leave-full-screen', {
    signal: AbortSignal.timeout(TRANSITION_TIMEOUT),
  }).catch(() => null);
  window.setFullScreen(fullScreen);
  await finished;
  asked.delete(window);
  if (!fullScreen) {
    setFullScreenBackground(window, false);
  }
  return true;
}

/** Lets the renderer take its window full screen, for the viewer and the reader. */
export function registerFullScreenAPI(): void {
  ipcMain.handle(FULL_SCREEN_CHANNELS.set, (event, fullScreen: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window && typeof fullScreen === 'boolean' ? setFullScreen(window, fullScreen) : false;
  });
}

/** Tells the window's page when it leaves full screen some other way, as from its green button. */
export function watchFullScreen(window: BrowserWindow): void {
  // Moving between Spaces on macOS can take keyboard focus from the page, stopping its keys.
  window.on('enter-full-screen', () => window.webContents.focus());
  window.on('leave-full-screen', () => {
    window.webContents.focus();
    if (!asked.has(window)) {
      setFullScreenBackground(window, false);
      window.webContents.send(FULL_SCREEN_CHANNELS.changed, false);
    }
  });
}
