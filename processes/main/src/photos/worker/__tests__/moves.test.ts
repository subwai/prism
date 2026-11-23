import type * as ReadFolder from '#photos/worker/disk/read-folder';
import { readFolder } from '#photos/worker/disk/read-folder';
import { renameEntry } from '#photos/worker/edits/rename';
import { PhotoLibrary } from '#photos/worker/library/library';
import { emptyFilter } from '@prism/shared';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, expect, onTestFinished, test, vi } from 'vitest';

// Each folder's listing, as it is, so the tests see which happen; `Big`'s folders list photos
// that are not on disk, as a share holding hundreds of thousands would.
vi.mock(import('#photos/worker/disk/read-folder'), async (original) => {
  const actual = await original();
  return { ...actual, readFolder: vi.fn(actual.readFolder) };
});

const actual = await vi.importActual<typeof ReadFolder>('#photos/worker/disk/read-folder');

const FOLDERS = 10;
const PHOTOS_EACH = 23_700;
const METADATA = { accessedMs: 0, createdMs: 0, inode: '0', modifiedMs: 1000, size: 50 };

beforeEach(() => {
  vi.mocked(readFolder)
    .mockClear()
    .mockImplementation(async function* fakePhotos(root, directoryId, options) {
      for await (const item of actual.readFolder(root, directoryId, options)) {
        // Before the times, which comes last, as every photo is listed by then.
        if (item.kind === 'folder-times' && path.dirname(directoryId) !== '.') {
          for (let photo = 0; photo < PHOTOS_EACH; photo += 1) {
            const name = `${photo}.jpg`;
            const id = path.join(directoryId, name);
            yield {
              entry: { id, kind: 'image', metadata: METADATA, name, parentId: directoryId },
              kind: 'entry',
            };
          }
        }
        yield item;
      }
    });
});

/** The folders listed since the last call. */
function listed() {
  const ids = vi.mocked(readFolder).mock.calls.map(([, directoryId]) => directoryId);
  vi.mocked(readFolder).mockClear();
  return ids.toSorted();
}

/** A folder of its own for the test, by its canonical path. */
async function scratch() {
  const made = await mkdtemp(path.join(tmpdir(), 'photo-moves-'));
  onTestFinished(() => rm(made, { force: true, recursive: true }));
  return realpath(made);
}

/** A library whose folder `Big` holds folders of 237,000 photos in all, read to the end. */
async function withBig() {
  const made = await scratch();
  for (let folder = 0; folder < FOLDERS; folder += 1) {
    await mkdir(path.join(made, 'Big', `Day ${folder}`), { recursive: true });
  }
  const library = PhotoLibrary.open(made);
  onTestFinished(() => library.close());
  await library.checkEveryFolder();
  listed();
  return library;
}

function everythingIn(directoryId: string) {
  const spec = {
    descending: false,
    directoryId,
    filter: emptyFilter(),
    recursive: true,
    search: '',
    show: 'all',
    sort: 'name',
    suggesting: false,
  } as const;
  return spec;
}

// Reading the photos into the catalog first takes seconds, longer while other suites run.
test(
  'renaming a folder of 237,000 photos moves them in the catalog, reading only the folder',
  { timeout: 60_000 },
  async () => {
    const library = await withBig();
    await renameEntry(library, 'Big', 'Huge');
    // The folder itself is read again in the background, to confirm.
    await library.readFolder('Huge');
    expect(listed()).toEqual(['Huge']);

    // What is inside it stays read this session, under its new name, so a view of it reads
    // nothing, and shows everything at once.
    const view = await library.views.open(everythingIn('Huge'));
    await library.views.current();
    const [state] = await library.views.current();
    expect(listed()).toEqual([]);
    expect(state?.count).toBe(FOLDERS + FOLDERS * PHOTOS_EACH);
    const rows = await library.views.rows(view.viewId, state?.version ?? 0, 0, 2);
    expect(rows?.map(({ id }) => id)).toEqual([
      path.join('Huge', 'Day 0'),
      path.join('Huge', 'Day 1'),
    ]);

    // The watcher's report of the rename has nothing left to say.
    await expect(
      library.describeChanges([
        { id: 'Big', parentId: '.' },
        { id: 'Huge', parentId: '.' },
      ]),
    ).resolves.toEqual([]);
    expect(listed()).toEqual([]);
  },
);

test('a rename the catalog cannot make in place reads what came', async () => {
  const made = await scratch();
  await mkdir(path.join(made, 'Trips'));
  await writeFile(path.join(made, 'Trips', 'photo.jpg'), 'photo');
  await mkdir(path.join(made, 'Holidays'));
  const library = PhotoLibrary.open(made);
  onTestFinished(() => library.close());
  await library.readFolder('.');
  await library.readFolder('Trips');
  // Gone behind the catalog's back, which still has it.
  await rm(path.join(made, 'Holidays'), { recursive: true });
  listed();

  await renameEntry(library, 'Trips', 'Holidays');
  await library.readFolder('Holidays');
  const { entries } = await library.listFolder('Holidays');
  expect(entries.map(({ id }) => id)).toEqual([path.join('Holidays', 'photo.jpg')]);
  expect(listed()).toContain('Holidays');
  expect((await library.listFolder('.')).entries.map(({ id }) => id)).toEqual(['Holidays']);
});
