import { watchFullScreen } from '#full-screen';
import { isRendererURL, rendererURL } from '#renderer-url';
import { MAC_BACKGROUND, WINDOW_BACKGROUND } from '#window-background';
import { keepWindowState, savedWindowState } from '#window-state';
// Packaged builds take their icon from electron-builder, and development runs on macOS from a
// Prism-named copy of Electron.app; elsewhere they run inside the stock Electron.
import icon from '@prism/brand/icon.png?asset';
import { APP_NAME, DEBUG_ARGUMENT, DEVELOPMENT_ARGUMENT } from '@prism/shared';
import { app, BrowserWindow, type BrowserWindowConstructorOptions, nativeTheme } from 'electron';
import path from 'node:path';

const WINDOW_HEIGHT = 780;
const WINDOW_WIDTH = 1180;
// Where native macOS windows put them, which centres them in the 52px title bar.
const TRAFFIC_LIGHT_INSET = 19;

// macOS draws the traffic lights over the renderer, which paints its own title bar.
const MAC_FRAME = {
  ...MAC_BACKGROUND,
  titleBarStyle: 'hidden',
  // oxlint-disable-next-line id-length -- Electron's Point shape.
  trafficLightPosition: { x: TRAFFIC_LIGHT_INSET, y: TRAFFIC_LIGHT_INSET },
  visualEffectState: 'followWindow',
} as const satisfies BrowserWindowConstructorOptions;

/**
 * The window's arguments: whether it runs unpackaged, and the logs `DEBUG` turns on, which the
 * sandbox keeps it from reading itself.
 */
function windowArguments() {
  const debug = process.env.DEBUG;
  return [
    ...(app.isPackaged ? [] : [DEVELOPMENT_ARGUMENT]),
    ...(debug ? [`${DEBUG_ARGUMENT}${debug}`] : []),
  ];
}

/** Writes the window's debug logs to the terminal, after the main process's own. */
function forwardDebugLogs(window: BrowserWindow) {
  if (!process.env.DEBUG) {
    return;
  }
  window.webContents.on('console-message', ({ message }) => {
    if (message.includes('prism:')) {
      process.stderr.write(`[window] ${message}\n`);
    }
  });
}

export function createWindow(): void {
  // The renderer is styled dark only, so the native sidebar material must match it.
  nativeTheme.themeSource = 'dark';
  // End-to-end tests drive the window unseen, so a run doesn't take over the screen.
  const hidden = !app.isPackaged && process.env.ELECTRON_HEADLESS === '1';
  if (hidden) {
    app.dock?.hide();
  }
  const saved = savedWindowState();
  const window = new BrowserWindow({
    backgroundColor: WINDOW_BACKGROUND,
    height: WINDOW_HEIGHT,
    ...(!app.isPackaged && process.platform !== 'darwin' && { icon }),
    minHeight: 520,
    minWidth: 740,
    show: !hidden,
    title: APP_NAME,
    webPreferences: {
      additionalArguments: windowArguments(),
      // A hidden page would otherwise pause animation frames, which zooming waits on.
      backgroundThrottling: !hidden,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
    },
    width: WINDOW_WIDTH,
    ...saved?.bounds,
    ...(process.platform === 'darwin' && MAC_FRAME),
  });
  // Maximizing or filling the screen shows the window, which tests keep hidden.
  if (saved?.maximized && !hidden) {
    window.maximize();
  }
  if (saved?.fullScreen && !hidden) {
    window.setFullScreen(true);
  }
  keepWindowState(window);

  forwardDebugLogs(window);
  watchFullScreen(window);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isRendererURL(url)) {
      event.preventDefault();
    }
  });

  // Back on the page it showed before restarting into an update, the only close that saves one.
  const page = saved?.page && new URL(saved.page, rendererURL());
  window.loadURL(page && isRendererURL(page.href) ? page.href : rendererURL().href);
}
