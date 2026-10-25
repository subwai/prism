import macIcon from '../../../resources/icon-mac.png?asset';
// Packaged builds take their icon from electron-builder; development runs inside the stock Electron.app.
import icon from '../../../resources/icon.png?asset';
import { APP_NAME } from '@prism/shared';
import { app, BrowserWindow, type BrowserWindowConstructorOptions, nativeTheme } from 'electron';
import path from 'node:path';

const WINDOW_HEIGHT = 780,
  WINDOW_WIDTH = 1180,
  TRAFFIC_LIGHT_INSET = 18;

// macOS draws the traffic lights over the renderer, which paints its own title bar.
const MAC_FRAME = {
  // Transparent pixels show the vibrancy material; the renderer paints everything else.
  backgroundColor: '#00000000',
  titleBarStyle: 'hidden',
  // oxlint-disable-next-line id-length -- Electron's Point shape.
  trafficLightPosition: { x: TRAFFIC_LIGHT_INSET, y: TRAFFIC_LIGHT_INSET },
  vibrancy: 'sidebar',
  visualEffectState: 'followWindow'
} as const satisfies BrowserWindowConstructorOptions;

export function createWindow(): void {
  // The renderer is styled dark only, so the native sidebar material must match it.
  nativeTheme.themeSource = 'dark';
  // End-to-end tests drive the window unseen, so a run doesn't take over the screen.
  const hidden = !app.isPackaged && process.env.ELECTRON_HEADLESS === '1';
  if (hidden) {
    app.dock?.hide();
  } else if (!app.isPackaged) {
    app.dock?.setIcon(macIcon);
  }
  const window = new BrowserWindow({
    // Platforms without vibrancy show this behind the transparent sidebar.
    backgroundColor: '#262626',
    height: WINDOW_HEIGHT,
    ...(!app.isPackaged && process.platform !== 'darwin' && { icon }),
    minHeight: 520,
    minWidth: 740,
    show: !hidden,
    title: APP_NAME,
    webPreferences: {
      // A hidden page would otherwise pause animation frames, which zooming waits on.
      backgroundThrottling: !hidden,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true
    },
    width: WINDOW_WIDTH,
    ...(process.platform === 'darwin' && MAC_FRAME)
  });
  let rendererURL = 'app://app/';
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    rendererURL = process.env.ELECTRON_RENDERER_URL;
  }

  // Leaving full screen on macOS can take keyboard focus from the page, stopping its shortcuts.
  window.on('leave-html-full-screen', () => window.webContents.focus());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = new URL(rendererURL),
      destination = new URL(url);
    if (destination.protocol !== allowed.protocol || destination.host !== allowed.host) {
      event.preventDefault();
    }
  });

  window.loadURL(rendererURL);
}
