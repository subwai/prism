import { PhotoLibrary } from '#photos/worker/library';
import type * as ReadFolder from '#photos/worker/read-folder';
import { readFolder, stampOf } from '#photos/worker/read-folder';
import { prepareIndex, prepareRatings } from '@prism/catalog';
import { chmod, mkdir, mkdtemp, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';

// Each folder's listing and look at its own times, as they are, so the tests see which happen.
vi.mock(import('#photos/worker/read-folder'), async (original) => {
  const actual = await original();
  return {
    ...actual,
    readFolder: vi.fn(actual.readFolder),
    stampOf: vi.fn(actual.stampOf),
  };
});

const actual = await vi.importActual<typeof ReadFolder>('#photos/worker/read-folder');

beforeEach(() => {
  vi.mocked(readFolder).mockClear();
  // Back to the disk's own times, as `timesStay` sets others.
  vi.mocked(stampOf).mockClear().mockImplementation(actual.stampOf);
});

async function folder(prefix: string) {
  const made = await mkdtemp(path.join(tmpdir(), prefix));
  onTestFinished(() => rm(made, { force: true, recursive: true }));
  return realpath(made);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Opens the library at `root` on the catalog kept in `catalog`, as each launch does, `atMs` from
 * now if given.
 */
function launch(root: string, catalog: string, atMs = 0) {
  const library = PhotoLibrary.open(
    root,
    {
      index: prepareIndex(path.join(catalog, 'index.db')),
      ratings: prepareRatings(path.join(catalog, 'ratings.db')),
    },
    undefined,
    () => Date.now() + atMs,
  );
  onTestFinished(() => library.close());
  return library;
}

/** The folders listed since the last call. */
function listed() {
  const ids = vi.mocked(readFolder).mock.calls.map(([, directoryId]) => directoryId);
  vi.mocked(readFolder).mockClear();
  return ids.toSorted();
}

/**
 * As a share whose folder `folderId` keeps its times from now on, whatever happens to it, so a
 * launch looking at it reads it only if the catalog kept no stamp of it.
 */
async function timesStay(root: string, folderId: string) {
  const now = await actual.stampOf(root, folderId);
  vi.mocked(stampOf).mockImplementation((at, id) =>
    id === folderId ? Promise.resolve(now) : actual.stampOf(at, id),
  );
}

/**
 * The entries of `folderId` once the catalog holds what its reads wrote, which a launch's walk
 * settles before; it is read first unless this session read it.
 */
async function entriesIn(library: PhotoLibrary, folderId: string) {
  await library.readFolder(folderId);
  return (await library.listFolder(folderId)).entries;
}

async function sizeIn(library: PhotoLibrary, id: string) {
  const entries = await entriesIn(library, path.dirname(id));
  return entries.find((entry) => entry.id === id)?.metadata?.size;
}

function idsOf(entries: { id: string }[]) {
  return entries.map((entry) => entry.id);
}

test('a launch lists only the folders that changed, and still walks into those that did not', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Trips', 'Beach'), { recursive: true });
  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'a');
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  // An empty catalog reads every folder.
  expect(listed()).toEqual(['.', 'Trips', 'Trips/Beach']);
  await first.close();

  // A file rewritten in place leaves its folder as it was; one added deep inside does not.
  await writeFile(path.join(root, 'Trips', 'a.jpg'), 'longer');
  await writeFile(path.join(root, 'Trips', 'Beach', 'b.jpg'), '');
  const again = launch(root, catalog);
  await again.checkEveryFolder();
  expect(listed()).toEqual(['Trips/Beach']);
  expect(vi.mocked(stampOf).mock.calls.map(([, id]) => id)).toContain('Trips');
  expect(idsOf(await entriesIn(again, 'Trips/Beach'))).toEqual(['Trips/Beach/b.jpg']);
  // The file rewritten is found once the window reads its folder.
  expect(await sizeIn(again, 'Trips/a.jpg')).toBe(6);
});

test('a launch reads a folder an entry came to or left, even with its times set back', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Album'));
  await mkdir(path.join(root, 'Trips'));
  await writeFile(path.join(root, 'Album', 'a.jpg'), '');
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  await first.close();

  await rm(path.join(root, 'Album', 'a.jpg'));
  const before = await stat(path.join(root, 'Trips'));
  await writeFile(path.join(root, 'Trips', 'b.jpg'), '');
  // As a copy that keeps folders' times does: the change time still moves.
  await utimes(path.join(root, 'Trips'), before.atime, before.mtime);
  listed();
  const again = launch(root, catalog);
  await again.checkEveryFolder();
  expect(listed()).toEqual(['Album', 'Trips']);
  expect(await entriesIn(again, 'Album')).toEqual([]);
  expect(idsOf(await entriesIn(again, 'Trips'))).toEqual(['Trips/b.jpg']);
});

test('a launch reads again a folder whose last read failed', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Album'));
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  await first.close();

  await timesStay(root, 'Album');
  const second = launch(root, catalog);
  await chmod(path.join(root, 'Album'), 0o000);
  onTestFinished(() => chmod(path.join(root, 'Album'), 0o755));
  await expect(second.readFolder('Album')).resolves.toMatchObject({
    error: expect.stringMatching(/EACCES/u),
  });
  await second.close();

  await chmod(path.join(root, 'Album'), 0o755);
  await writeFile(path.join(root, 'Album', 'a.jpg'), '');
  listed();
  const third = launch(root, catalog);
  await third.checkEveryFolder();
  expect(listed()).toEqual(['Album']);
  expect(idsOf(await entriesIn(third, 'Album'))).toEqual(['Album/a.jpg']);
});

test("a launch reads again a folder whose last read could not read every entry's details", async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Album'));
  await writeFile(path.join(root, 'Album', 'a.jpg'), 'a');
  // Its names can be listed, but nothing inside it looked at.
  await chmod(path.join(root, 'Album'), 0o644);
  onTestFinished(() => chmod(path.join(root, 'Album'), 0o755));
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  expect(await sizeIn(first, 'Album/a.jpg')).toBeUndefined();
  await first.close();

  await timesStay(root, 'Album');
  await chmod(path.join(root, 'Album'), 0o755);
  listed();
  const again = launch(root, catalog);
  await again.checkEveryFolder();
  expect(listed()).toEqual(['Album']);
  expect(await sizeIn(again, 'Album/a.jpg')).toBe(1);
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
  expect(listed()).toEqual([]);
  await inSixDays.close();

  const inEightDays = launch(root, catalog, 8 * DAY_MS);
  await inEightDays.checkEveryFolder();
  expect(listed()).toEqual(['.', 'Trips']);
  expect(await sizeIn(inEightDays, 'Trips/a.jpg')).toBe(6);
  await inEightDays.close();

  // That read counts from when it ended.
  const inTenDays = launch(root, catalog, 10 * DAY_MS);
  await inTenDays.checkEveryFolder();
  expect(listed()).toEqual([]);
});

test('a full read the library closed during leaves the next launch to read in full', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Album'));
  await mkdir(path.join(root, 'Trips'));
  const first = launch(root, catalog);
  // Closed as the walk gets inside the library's own folder.
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

  const again = launch(root, catalog, DAY_MS);
  await again.checkEveryFolder();
  expect(listed()).toEqual(['.', 'Album', 'Trips']);
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
  expect(listed()).toEqual([]);
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
  expect(listed()).toEqual([]);
});
