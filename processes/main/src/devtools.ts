import { installExtension, REACT_DEVELOPER_TOOLS } from '@app/electron-devtools-installer';
import { app } from 'electron';

/**
 * Adds React DevTools to the dev server's windows. It has to load before the page does, so its
 * hook runs ahead of React. Builds and end-to-end runs skip it, as they load the app without the
 * dev server.
 */
export async function installDevTools(): Promise<void> {
  if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL) {
    return;
  }
  try {
    await installExtension(REACT_DEVELOPER_TOOLS);
  } catch (error) {
    // Offline, say: the app still runs, without the React panels.
    process.stderr.write(`React DevTools failed to install: ${String(error)}\n`);
  }
}
