import { traceView } from './trace.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { test as base, inject } from 'vitest';

type OnCleanup = (cleanup: () => Promise<void>) => void;

/** What tests replace in the main process, kept at launch to put back before the next test. */
type Originals = typeof globalThis & {
  e2eOriginals?: {
    openPath: Electron.Shell['openPath'];
    popup: Electron.Menu['popup'];
    showItemInFolder: Electron.Shell['showItemInFolder'];
    showOpenDialog: Electron.Dialog['showOpenDialog'];
    size: number[];
  };
};

/** What the app keeps in its profile as it is used, which the next test must not find. */
const PROFILE_ENTRIES = ['last-folder.json', 'photo-thumbnails-v1'];

/** Launches the built app with a profile of its own, both gone when the scope ends. */
async function launch(onCleanup: OnCleanup) {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'e2e-profile-'));
  const app = await electron.launch({
    args: [path.resolve(import.meta.dirname, '../..'), `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_HEADLESS: inject('headed') ? '0' : '1' },
    executablePath: inject('electronPath'),
  });
  onCleanup(async () => {
    await app.close();
    await rm(userData, { force: true, recursive: true });
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow, dialog, Menu, shell }) => {
    (globalThis as Originals).e2eOriginals = {
      openPath: shell.openPath,
      popup: Menu.prototype.popup,
      showItemInFolder: shell.showItemInFolder,
      showOpenDialog: dialog.showOpenDialog,
      size: BrowserWindow.getAllWindows()[0]?.getSize() ?? [],
    };
  });
  return app;
}

/**
 * Returns a used app to how it launched: the main process's replaced functions, the window's
 * size, the profile's files, a fresh page with no history behind it, and no emulated media.
 * A viewport set with `setViewportSize` stays, as Playwright cannot unset it.
 */
async function reset(app: ElectronApplication, page: Page) {
  const userData = await app.evaluate(({ app: main, BrowserWindow, dialog, Menu, shell }) => {
    const originals = (globalThis as Originals).e2eOriginals;
    if (originals) {
      shell.openPath = originals.openPath;
      Menu.prototype.popup = originals.popup;
      shell.showItemInFolder = originals.showItemInFolder;
      dialog.showOpenDialog = originals.showOpenDialog;
      const [width, height] = originals.size;
      if (width && height) {
        BrowserWindow.getAllWindows()[0]?.setSize(width, height);
      }
    }
    return main.getPath('userData');
  });
  await Promise.all(
    PROFILE_ENTRIES.map((entry) =>
      rm(path.join(userData, entry), { force: true, recursive: true }),
    ),
  );
  await page.emulateMedia({
    colorScheme: null,
    contrast: null,
    forcedColors: null,
    reducedMotion: null,
  });
  // Leaving the page closes the folder it had open, as reloading it would.
  await page.goto(new URL('/', page.url()).href, { waitUntil: 'domcontentloaded' });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.navigationHistory.clear();
  });
}

/** Has the folder dialog, which is native, answer with `folder` instead. */
function answerFolderDialog(app: ElectronApplication, folder: string) {
  return app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
}

const used = new WeakSet<ElectronApplication>();

/**
 * Each file launches the built app once, as a launch costs more than most tests, and each test
 * starts from the app as it launched; see `reset`. A file whose tests change more than `reset`
 * undoes, as the keybindings tests do, overrides `app` with `freshApp` to launch one per test.
 */
export const test = base
  .extend('photos', { scope: 'worker' }, () => inject('photos'))
  // oxlint-disable-next-line no-empty-pattern -- Vitest reads what a fixture needs from it.
  .extend('sharedApp', { scope: 'file' }, ({}, { onCleanup }) => launch(onCleanup))
  .extend('app', async ({ photos, sharedApp }) => {
    if (used.has(sharedApp)) {
      await reset(sharedApp, await sharedApp.firstWindow());
    }
    used.add(sharedApp);
    await answerFolderDialog(sharedApp, photos);
    return sharedApp;
  })
  .extend('page', async ({ app, task }, { onCleanup }) => {
    const page = await app.firstWindow();
    if (inject('traceView')) {
      onCleanup(traceView(app, page, task));
    }
    return page;
  });

/** An app launched for the test alone, for `test.override('app', freshApp)`. */
export async function freshApp(
  { photos }: { photos: string },
  { onCleanup }: { onCleanup: OnCleanup },
) {
  const app = await launch(onCleanup);
  await answerFolderDialog(app, photos);
  return app;
}

export async function openFolder(page: Page) {
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('listbox', { name: 'Folder contents' }).waitFor();
}
