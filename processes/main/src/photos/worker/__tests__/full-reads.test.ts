import { DAY_MS, folder, launch, listed, sizeIn } from '#photos/worker/__tests__/launches';
import type * as ReadFolder from '#photos/worker/read-folder';
import { readFolder } from '#photos/worker/read-folder';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';

// Each folder's listing, as it is, so the tests see which happen.
vi.mock(import('#photos/worker/read-folder'), async (original) => {
  const actual = await original();
  return { ...actual, readFolder: vi.fn(actual.readFolder) };
});

const actual = await vi.importActual<typeof ReadFolder>('#photos/worker/read-folder');

beforeEach(() => {
  vi.mocked(readFolder).mockClear().mockImplementation(actual.readFolder);
});

test('a launch reads every folder in full once a week, for files rewritten in place', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Trips'));
  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'a');
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  expect(listed()).toEqual(['.', 'Trips']);
  await first.close();

  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'longer');
  const inSixDays = launch(root, catalog, 6 * DAY_MS);
  await inSixDays.checkEveryFolder();
  expect(listed()).toEqual(['.']);
  await inSixDays.close();

  const inEightDays = launch(root, catalog, 8 * DAY_MS);
  await inEightDays.checkEveryFolder();
  expect(listed()).toEqual(['.', 'Trips']);
  expect(await sizeIn(inEightDays, 'Trips/a.jpg')).toBe(6);
  await inEightDays.close();

  // That read counts from when it ended.
  const inTenDays = launch(root, catalog, 10 * DAY_MS);
  await inTenDays.checkEveryFolder();
  expect(listed()).toEqual(['.']);
});

/** Launches the library and closes it as its first full read gets inside the library's folder. */
async function closedDuringFullRead(root: string, catalog: string) {
  const first = launch(root, catalog);
  let closing: Promise<void> | undefined;
  vi.mocked(readFolder).mockImplementation((at, id, options) => {
    if (id !== '.') {
      closing ??= first.close();
    }
    return actual.readFolder(at, id, options);
  });
  await first.checkEveryFolder();
  await closing;
  vi.mocked(readFolder).mockImplementation(actual.readFolder);
  listed();
}

test('a launch takes up a full read the library closed during, leaving the folders it read', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Album'));
  await mkdir(path.join(root, 'Trips'));
  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'a');
  await closedDuringFullRead(root, catalog);

  // Rewritten in place, which only a full read finds.
  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'longer');
  const again = launch(root, catalog, DAY_MS);
  await again.checkEveryFolder();
  expect(listed()).toEqual(['Album', 'Trips']);
  expect(await sizeIn(again, 'Trips/a.jpg')).toBe(6);
  await again.close();

  // It got to the end, so the next launch reads only what changed.
  const later = launch(root, catalog, 2 * DAY_MS);
  await later.checkEveryFolder();
  expect(listed()).toEqual(['.']);
});

test('a full read taken up again leaves the folders the window read since it began', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Album'));
  await mkdir(path.join(root, 'Trips'));
  await closedDuringFullRead(root, catalog);

  const opened = launch(root, catalog, DAY_MS);
  await opened.readFolder('Trips');
  await opened.close();
  listed();

  const again = launch(root, catalog, 2 * DAY_MS);
  await again.checkEveryFolder();
  expect(listed()).toEqual(['Album']);
});

test('a launch starts a full read afresh once the one the library closed during is a week old', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Album'));
  await closedDuringFullRead(root, catalog);

  const again = launch(root, catalog, 8 * DAY_MS);
  await again.checkEveryFolder();
  expect(listed()).toEqual(['.', 'Album']);
});

test('reading the library again reads every folder, even with a full read to take up', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Album'));
  await mkdir(path.join(root, 'Trips'));
  await closedDuringFullRead(root, catalog);

  const again = launch(root, catalog, DAY_MS);
  // Asked for as the launch's check takes the full read up again: a new one follows it.
  let reading: Promise<void> | undefined;
  vi.mocked(readFolder).mockImplementation((at, id, options) => {
    reading ??= again.readEveryFolder();
    return actual.readFolder(at, id, options);
  });
  await again.checkEveryFolder();
  vi.mocked(readFolder).mockImplementation(actual.readFolder);
  expect(again.readEveryFolder()).toBe(reading);
  await reading;
  // The one taken up again, then the new one, which reads every folder.
  expect(listed()).toEqual(['.', 'Album', 'Album', 'Trips', 'Trips']);
});

test('reading the library again reads every folder in full once, however often it is asked', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Trips'));
  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'a');
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  listed();
  await first.close();

  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'longer');
  const later = launch(root, catalog, 5 * DAY_MS);
  await later.checkEveryFolder();
  expect(listed()).toEqual(['.']);
  const reading = later.readEveryFolder();
  expect(later.readEveryFolder()).toBe(reading);
  await reading;
  // Folders this session looked at included.
  expect(listed()).toEqual(['.', 'Trips']);
  expect(await sizeIn(later, 'Trips/a.jpg')).toBe(6);
  await later.close();

  // A week after the launch's full read, but not after this one.
  const inEightDays = launch(root, catalog, 8 * DAY_MS);
  await inEightDays.checkEveryFolder();
  expect(listed()).toEqual(['.']);
});
