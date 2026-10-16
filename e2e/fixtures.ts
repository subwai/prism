import { traceView } from './trace.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type Page } from 'playwright-core';
import { test as base, inject } from 'vitest';

/** Each test launches the built app with its own profile, so no state leaks between runs. */
export const test = base
  .extend('photos', { scope: 'worker' }, () => inject('photos'))
  .extend('app', async ({ photos }, { onCleanup }) => {
    const userData = await mkdtemp(path.join(os.tmpdir(), 'e2e-profile-'));
    const app = await electron.launch({
      args: [path.resolve(import.meta.dirname, '..'), `--user-data-dir=${userData}`],
      // Headless unless the run sets `ELECTRON_HEADLESS=0`, to watch it.
      env: { ...process.env, ELECTRON_HEADLESS: process.env.ELECTRON_HEADLESS ?? '1' }
    });
    onCleanup(async () => {
      await app.close();
      await rm(userData, { force: true, recursive: true });
    });
    // The folder dialog is native, so it answers with the generated photos instead.
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, photos);
    return app;
  })
  .extend('page', async ({ app, task }, { onCleanup }) => {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    if (inject('traceView')) {
      onCleanup(traceView(app, page, task));
    }
    return page;
  });

export async function openFolder(page: Page) {
  await page.getByRole('button', { name: 'Choose a folder' }).click();
  await page.getByRole('listbox', { name: 'Folder contents' }).waitFor();
}
