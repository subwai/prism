import {
  DAY_MS,
  entriesIn,
  folder,
  idsOf,
  launch,
  listed,
  sizeIn,
} from '#photos/worker/__tests__/launches';
import type * as ReadFolder from '#photos/worker/indexer/read-folder';
import { readFolder, readFolderStamp } from '#photos/worker/indexer/read-folder';
import { chmod, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';

// Each folder's listing and look at its own times, as they are, so the tests see which happen.
vi.mock(import('#photos/worker/indexer/read-folder'), async (original) => {
  const actual = await original();
  return {
    ...actual,
    readFolder: vi.fn(actual.readFolder),
    readFolderStamp: vi.fn(actual.readFolderStamp),
  };
});

const actual = await vi.importActual<typeof ReadFolder>('#photos/worker/indexer/read-folder');

beforeEach(() => {
  vi.mocked(readFolder).mockClear();
  // Back to the disk's own times, as `timesStay` sets others.
  vi.mocked(readFolderStamp).mockClear().mockImplementation(actual.readFolderStamp);
});

/**
 * As a share whose folder `folderId` keeps its times from now on, whatever happens to it, so a
 * launch looking at it reads it only if the catalog kept no stamp of it.
 */
async function timesStay(root: string, folderId: string) {
  const now = await actual.readFolderStamp(root, folderId);
  vi.mocked(readFolderStamp).mockImplementation((at, id) =>
    id === folderId ? Promise.resolve(now) : actual.readFolderStamp(at, id),
  );
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
  expect(listed()).toEqual(['.', 'Trips/Beach']);
  expect(vi.mocked(readFolderStamp).mock.calls.map(([, id]) => id)).toContain('Trips');
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
  expect(listed()).toEqual(['.', 'Album', 'Trips']);
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
  expect(listed()).toEqual(['.', 'Album']);
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
  expect(listed()).toEqual(['.', 'Album']);
  expect(await sizeIn(again, 'Album/a.jpg')).toBe(1);
});

test('a launch reads a folder new to the catalog without looking for its stamp', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Trips'));
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  await first.close();

  await mkdir(path.join(root, 'Trips', 'Beach'));
  listed();
  vi.mocked(readFolderStamp).mockClear();
  const again = launch(root, catalog, DAY_MS);
  await again.checkEveryFolder();
  expect(listed()).toEqual(['.', 'Trips', 'Trips/Beach']);
  expect(vi.mocked(readFolderStamp).mock.calls.map(([, id]) => id)).toEqual(['Trips']);
});

/** A read that fails with `error` before it finds an entry. */
// oxlint-disable-next-line require-yield -- It yields nothing, as the read it stands for fails.
async function* failedRead(error: Error): AsyncGenerator<never, void> {
  throw error;
}

/**
 * As a share on which the folder `folderId` is listed in its parent but cannot be looked at or
 * read by its path, as SMB on macOS answers for names that end in a dot or a space.
 */
function unreachable(folderId: string) {
  const missing = () => Object.assign(new Error(`ENOENT: ${folderId}`), { code: 'ENOENT' });
  vi.mocked(readFolderStamp).mockImplementation((at, id) =>
    id === folderId ? Promise.reject(missing()) : actual.readFolderStamp(at, id),
  );
  vi.mocked(readFolder).mockImplementation((at, id, options) =>
    id === folderId ? failedRead(missing()) : actual.readFolder(at, id, options),
  );
  onTestFinished(() => {
    vi.mocked(readFolder).mockImplementation(actual.readFolder);
  });
}

test('a launch leaves unread a folder that cannot be looked at while its parent is unchanged', async () => {
  const root = await folder('unchanged-');
  const catalog = await folder('unchanged-catalog-');
  await mkdir(path.join(root, 'Pictures', 'Bababear.'), { recursive: true });
  unreachable('Pictures/Bababear.');
  const first = launch(root, catalog);
  await first.checkEveryFolder();
  expect(listed()).toEqual(['.', 'Pictures', 'Pictures/Bababear.']);
  await first.close();

  const again = launch(root, catalog, DAY_MS);
  await again.checkEveryFolder();
  expect(listed()).toEqual(['.']);
  // The window asking for it still reads it, and is sent that it failed.
  await expect(again.readFolder('Pictures/Bababear.')).resolves.toMatchObject({
    error: expect.stringMatching(/ENOENT/u),
  });
  await again.close();
  listed();

  // Anything that comes to or leaves its parent has it read again.
  await writeFile(path.join(root, 'Pictures', 'a.jpg'), '');
  const later = launch(root, catalog, 2 * DAY_MS);
  await later.checkEveryFolder();
  expect(listed()).toEqual(['.', 'Pictures', 'Pictures/Bababear.']);
});
