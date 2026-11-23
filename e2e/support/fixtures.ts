import { endTest, startRecording, startTest } from './evidence.ts';
import { startTraceView } from './trace.ts';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { test as base, inject, type onTestFinished } from 'vitest';

type OnCleanup = (cleanup: () => Promise<void>) => void;

/** What tests replace in the main process, kept at launch to put back before the next test. */
type Originals = typeof globalThis & {
  e2eOriginals?: {
    copyText: Electron.Clipboard['writeText'];
    openPath: Electron.Shell['openPath'];
    popup: Electron.Menu['popup'];
    showItemInFolder: Electron.Shell['showItemInFolder'];
    showOpenDialog: Electron.Dialog['showOpenDialog'];
    size: number[];
  };
};

/** What the app keeps in its profile as it is used, which the next test must not find. */
const PROFILE_ENTRY =
  /^(?:last-folder\.json|opened-folders\.json|current-folders\.json|window-state\.json|photo-thumbnails-v\d+|photo-index-v\d+\.db(?:-wal|-shm)?)$/u;

/**
 * Throws unless `app` keeps its data in the test profile `userData`. A development build would
 * otherwise keep it with the developer's, which `reset` clears.
 */
async function checkAppUsesProfile(app: ElectronApplication, userData: string) {
  const used = await app.evaluate(({ app: main }) => main.getPath('userData'));
  if ((await realpath(used)) !== (await realpath(userData))) {
    throw new Error(`The app keeps its data in ${used}, not the test profile ${userData}.`);
  }
}

/** Keeps the main process's functions that tests replace, and the window's size, for `reset`. */
function rememberOriginals(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow, clipboard, dialog, Menu, shell }) => {
    (globalThis as Originals).e2eOriginals = {
      copyText: clipboard.writeText,
      openPath: shell.openPath,
      popup: Menu.prototype.popup,
      showItemInFolder: shell.showItemInFolder,
      showOpenDialog: dialog.showOpenDialog,
      size: BrowserWindow.getAllWindows()[0]?.getSize() ?? [],
    };
  });
}

/** Puts back what `rememberOriginals` kept, and returns where the app keeps its data. */
function restoreOriginals(app: ElectronApplication) {
  return app.evaluate(({ app: main, BrowserWindow, clipboard, dialog, Menu, shell }) => {
    const originals = (globalThis as Originals).e2eOriginals;
    if (originals) {
      clipboard.writeText = originals.copyText;
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
}

/** Removes the files the app keeps in its profile as it is used; see `PROFILE_ENTRY`. */
async function removeProfileEntries(userData: string) {
  // Thumbnails the last test asked for can still land while the folder is removed, which
  // fails with ENOTEMPTY; `maxRetries` has `rm` try again.
  const entries = (await readdir(userData)).filter((entry) => PROFILE_ENTRY.test(entry));
  await Promise.all(
    entries.map((entry) =>
      rm(path.join(userData, entry), { force: true, maxRetries: 5, recursive: true }),
    ),
  );
}

/** Gives `page` no emulated media, no local storage and a fresh start with no history. */
async function resetPage(app: ElectronApplication, page: Page) {
  await page.emulateMedia({
    colorScheme: null,
    contrast: null,
    forcedColors: null,
    reducedMotion: null,
  });
  // Sizes set with the sliders and panes' edges, which the next page would open with.
  await page.evaluate(() => localStorage.clear());
  // Leaving the page closes the folder it had open, as reloading it would.
  await page.goto(new URL('/', page.url()).href, { waitUntil: 'domcontentloaded' });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.navigationHistory.clear();
  });
}

/**
 * Launches the built app with a profile of its own, both gone when the scope ends, or with
 * `profile`, which whoever made it removes.
 */
async function launch(onCleanup: OnCleanup, profile?: string) {
  const userData = profile ?? (await mkdtemp(path.join(os.tmpdir(), 'e2e-profile-')));
  const removeProfile = async () => {
    if (!profile) {
      await rm(userData, { force: true, maxRetries: 5, recursive: true });
    }
  };
  const app = await electron
    .launch({
      args: [path.resolve(import.meta.dirname, '../..'), `--user-data-dir=${userData}`],
      // Every log, which a failed test keeps with its evidence.
      env: {
        ...process.env,
        DEBUG: process.env.DEBUG ?? 'prism:*',
        ELECTRON_HEADLESS: inject('headed') ? '0' : '1',
      },
      executablePath: inject('electronPath'),
    })
    .catch(async (error: unknown) => {
      await removeProfile();
      throw error;
    });
  // A test may close it itself, to launch it again.
  let closed = false;
  app.once('close', () => {
    closed = true;
  });
  const close = async () => {
    if (!closed) {
      await app.close();
    }
    await removeProfile();
  };
  // The app's debug logs show with the test's own output when the run's `DEBUG` asks for them.
  if (process.env.DEBUG) {
    app.process().stderr?.pipe(process.stderr);
  }
  // Vitest skips the cleanups of a fixture whose setup throws, so a launch that fails closes
  // the app itself. Left open, an app outlives the run whenever its worker is killed.
  try {
    await startRecording(app);
    await checkAppUsesProfile(app, userData);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await rememberOriginals(app);
  } catch (error) {
    await close();
    throw error;
  }
  onCleanup(close);
  return app;
}

/**
 * Returns a used app to how it launched: the main process's replaced functions, the window's
 * size, the profile's files and local storage, a fresh page with no history behind it, and no
 * emulated media. A viewport set with `setViewportSize` stays, as Playwright cannot unset it.
 */
async function reset(app: ElectronApplication, page: Page) {
  const userData = await restoreOriginals(app);
  await removeProfileEntries(userData);
  await resetPage(app, page);
}

/** Has the folder dialog, which is native, answer with `folder` instead. */
export function answerFolderDialog(app: ElectronApplication, folder: string) {
  return app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
}

/** Apps a test has used, which the next test resets before it uses them. */
const usedApps = new WeakSet<ElectronApplication>();

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
    if (usedApps.has(sharedApp)) {
      await reset(sharedApp, await sharedApp.firstWindow());
    }
    usedApps.add(sharedApp);
    await answerFolderDialog(sharedApp, photos);
    return sharedApp;
  })
  .extend('page', async ({ app, task }, { onCleanup }) => {
    const page = await app.firstWindow();
    await startTest(app);
    onCleanup(() => endTest(app, task));
    if (inject('traceView')) {
      onCleanup(startTraceView(app, page, task));
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

/**
 * Quits `app` and launches it again with the same profile, as reopening it would. Its folder
 * dialog answers with `photos` again. The new app closes when the test ends, after its
 * evidence is kept if the test failed.
 */
export async function relaunch(
  app: ElectronApplication,
  photos: string,
  onFinished: typeof onTestFinished,
) {
  const userData = await app.evaluate(({ app: main }) => main.getPath('userData'));
  await app.close();
  const again = await launch(
    (close) =>
      onFinished(async ({ task }) => {
        await endTest(again, task);
        await close();
      }),
    userData,
  );
  await startTest(again);
  await answerFolderDialog(again, photos);
  return { app: again, page: await again.firstWindow() };
}

/** Opens the folder the folder dialog answers with, and waits for its contents. */
export async function openFolder(page: Page) {
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('listbox', { name: 'Folder contents' }).waitFor();
}

/** Opens the test photos' folder, and previews its landscape photo. */
export async function openPhoto(page: Page) {
  await openFolder(page);
  await page.getByRole('option', { name: 'landscape.jpg' }).click();
  await page.keyboard.press('Space');
  await page
    .getByRole('region', { name: 'Image preview' })
    .getByRole('img', { name: 'landscape.jpg' })
    .waitFor({ state: 'visible' });
}
