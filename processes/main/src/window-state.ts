import { isFullScreenForPage } from '#full-screen';
import { app, type BrowserWindow, type Rectangle, screen } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Where the window was and how it was sized when it last closed, to open the same way next. */
export interface WindowState {
  /** Its size and place when neither maximized nor full screen. */
  bounds: Rectangle;
  maximized: boolean;
  fullScreen: boolean;
}

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function isRectangle(value: unknown): value is Rectangle {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['x', 'y', 'width', 'height'].every((key) =>
      Number.isSafeInteger((value as Record<string, unknown>)[key]),
    )
  );
}

/** Whether enough of `bounds` is on a display still connected to grab its title bar. */
function isOnScreen(bounds: Rectangle) {
  const { workArea } = screen.getDisplayMatching(bounds);
  const across =
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
  return across >= 100 && bounds.y >= workArea.y && bounds.y < workArea.y + workArea.height - 40;
}

/**
 * How the window last closed, if it is still on a connected display. Read before the window is
 * made, so it opens there rather than moving; a lost file only opens it at its default size.
 */
export function savedWindowState(): WindowState | null {
  try {
    const saved = JSON.parse(readFileSync(windowStateFile(), 'utf8')) as Partial<
      Record<keyof WindowState, unknown>
    >;
    if (!isRectangle(saved.bounds) || !isOnScreen(saved.bounds)) {
      return null;
    }
    return {
      bounds: saved.bounds,
      fullScreen: saved.fullScreen === true,
      maximized: saved.maximized === true,
    };
  } catch {
    return null;
  }
}

/** Remembers how `window` is sized and placed when it closes. */
export function keepWindowState(window: BrowserWindow) {
  window.on('close', () => {
    const state: WindowState = {
      bounds: window.getNormalBounds(),
      // The viewer or the reader full screen is the page's, which opens without them.
      fullScreen: window.isFullScreen() && !isFullScreenForPage(window),
      maximized: window.isMaximized(),
    };
    try {
      // Written as it closes, when there is no later moment to finish an asynchronous write.
      writeFileSync(windowStateFile(), JSON.stringify(state));
    } catch {
      // Unsaved, the next launch opens at the default size.
    }
  });
}
