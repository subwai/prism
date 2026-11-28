import { DAY_MS, launch } from '#photos/worker/__tests__/launches';
import { openWindow } from '#photos/worker/__tests__/window';
import {
  type CallCounts,
  countFileSystemCalls,
} from '#photos/worker/disk/__tests__/file-system-call-counter';
import { createShareCheck, Share } from '#photos/worker/disk/share/share';
import { PrismTrashBatch } from '#photos/worker/disk/trash/prism-trash-batch';
import { watchFolder } from '#photos/worker/disk/watcher';
import { rateEntry } from '#photos/worker/edits/rating';
import { renameEntry } from '#photos/worker/edits/rename';
import { PhotoLibrary } from '#photos/worker/library/library';
import { findCachedThumbnail } from '#photos/worker/on-screen/cached-thumbnails';
import { deleteForGood } from '#photos/worker/trash/destination';
import { runTrashPlan } from '#photos/worker/trash/run';
import { prepareIndex, prepareRatings } from '@prism/catalog';
import { thumbnailCache } from '@prism/media';
import { emptyFilter, MAX_VIEW_ROWS, type TrashPlan } from '@prism/shared';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// How many times each flow calls the file system inside the library's folder, on a small library
// of folders of photos. On a network share every call is a trip across the network, about 4.3k a
// second, so a call more per photo costs minutes on a library of two million. A change that makes
// a flow look at the disk more often shows here; if it is needed, update the counts.

const TOP_FOLDERS = 4;
const SUBFOLDERS = 4;
const PHOTOS_PER_FOLDER = 10;

/** The library's own folder, the top folders, and the subfolders in each. */
const FOLDERS = 1 + TOP_FOLDERS + TOP_FOLDERS * SUBFOLDERS;
const PHOTOS = TOP_FOLDERS * SUBFOLDERS * PHOTOS_PER_FOLDER;
/** Every folder but the library's own is an entry of its parent, as every photo is. */
const ENTRIES = FOLDERS - 1 + PHOTOS;

/** The IDs of the photos in subfolder `sub` of the first top folder. */
function photosIn(sub: number) {
  return Array.from(
    { length: PHOTOS_PER_FOLDER },
    (_unused, index) => `top-0/sub-${sub}/${index}.jpg`,
  );
}

/** Makes the library: top folders of subfolders, each holding small JPEGs. */
async function makeLibrary(root: string) {
  const photo = await sharp({ create: { background: 'red', channels: 3, height: 8, width: 8 } })
    .jpeg()
    .toBuffer();
  for (let top = 0; top < TOP_FOLDERS; top += 1) {
    for (let sub = 0; sub < SUBFOLDERS; sub += 1) {
      const subfolder = path.join(root, `top-${top}`, `sub-${sub}`);
      await mkdir(subfolder, { recursive: true });
      await Promise.all(
        Array.from({ length: PHOTOS_PER_FOLDER }, (_unused, index) =>
          writeFile(path.join(subfolder, `${index}.jpg`), photo),
        ),
      );
    }
  }
}

/** The file-system calls `run` makes inside `root`. */
async function callsOf(root: string, run: () => Promise<unknown>): Promise<CallCounts> {
  const counter = countFileSystemCalls(root);
  try {
    await run();
  } finally {
    counter.stop();
  }
  return counter.counts();
}

/** Opens a view that needs every photo's details, and waits until all are read. */
async function readEveryDetail(library: PhotoLibrary) {
  await library.views.open({
    descending: false,
    directoryId: '.',
    filter: emptyFilter(),
    recursive: true,
    search: '',
    show: 'all',
    sort: 'taken',
    suggesting: false,
  });
  await vi.waitFor(
    async () => {
      const [view] = await library.views.current();
      for (let start = 0; start < ENTRIES; start += MAX_VIEW_ROWS) {
        const rows = await library.views.rows(
          view?.viewId ?? '',
          view?.version ?? 0,
          start,
          MAX_VIEW_ROWS,
        );
        expect(rows?.filter((row) => row.kind === 'image' && row.exif === undefined)).toEqual([]);
      }
    },
    { interval: 100, timeout: 30_000 },
  );
}

/** A plan that moves `targets` to the Trash. */
function trashPlan(targets: string[]): TrashPlan {
  const none = { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };
  return { groups: [], moves: [], rescued: none, targets, totals: none };
}

let scratch = '';
let root = '';
let catalog = '';
let cacheFolder = '';
let firstLaunch: CallCounts = {};
let details: CallCounts = {};

// Made once for every test, so each flow starts from a library the catalog has read in full.
beforeAll(async () => {
  const made = await mkdtemp(path.join(tmpdir(), 'file-system-calls-'));
  scratch = await realpath(made);
  root = path.join(scratch, 'library');
  catalog = path.join(scratch, 'catalog');
  cacheFolder = path.join(scratch, 'cache');
  await mkdir(catalog);
  await makeLibrary(root);
  const first = PhotoLibrary.open(root, {
    files: {
      index: prepareIndex(path.join(catalog, 'index.db')),
      ratings: prepareRatings(path.join(catalog, 'ratings.db')),
    },
  });
  try {
    firstLaunch = await callsOf(root, () => first.checkEveryFolder());
    details = await callsOf(root, () => readEveryDetail(first));
  } finally {
    await first.close();
  }
}, 60_000);

afterAll(() => rm(scratch, { force: true, recursive: true }));

test('the first launch reads each folder once and looks at each entry once', () => {
  expect(firstLaunch).toEqual({ lstat: FOLDERS, readdir: FOLDERS, realpath: 1, stat: ENTRIES });
});

test("reading a photo's details looks at its file, then opens it", () => {
  expect(details).toEqual({ open: PHOTOS, stat: PHOTOS });
});

test("a launch's quick check looks at each folder's times, and reads only the library's own", async () => {
  const library = launch(root, catalog, 60_000);
  expect(await callsOf(root, () => library.checkEveryFolder())).toEqual({
    lstat: FOLDERS,
    readdir: 1,
    realpath: 1,
    stat: TOP_FOLDERS,
  });
});

test("the weekly full read reads every folder again, finding each folder's real path", async () => {
  const library = launch(root, catalog, 8 * DAY_MS);
  expect(await callsOf(root, () => library.checkEveryFolder())).toEqual({
    lstat: FOLDERS,
    readdir: FOLDERS,
    realpath: FOLDERS,
    stat: ENTRIES,
  });
});

test('opening a folder reads it once, looking at each entry once', async () => {
  const library = launch(root, catalog, 60_000);
  const calls = await callsOf(root, async () => {
    await library.listFolder('top-1/sub-0');
    await library.readFolder('top-1/sub-0');
  });
  expect(calls).toEqual({ lstat: 1, readdir: 1, realpath: 1, stat: PHOTOS_PER_FOLDER });
});

test("making a thumbnail reads the photo once, and a cached one isn't looked at", async () => {
  const library = launch(root, catalog, 60_000);
  const window = openWindow(library, path.join(cacheFolder, 'thumbnails'));
  const shown = photosIn(0);
  const making = await callsOf(root, async () => {
    const results = Promise.all(shown.map((id) => window.nextThumbnailResult(id)));
    await window.show(shown);
    await results;
  });
  // Found inside the library, looked at for its key, read, and looked at again to check it did
  // not change while its thumbnail was made.
  expect(making).toEqual({
    readFile: shown.length,
    realpath: shown.length,
    stat: 2 * shown.length,
  });

  const cache = thumbnailCache(path.join(cacheFolder, 'thumbnails'));
  const finding = await callsOf(root, () =>
    Promise.all(shown.map((id) => findCachedThumbnail(library, cache, id))),
  );
  expect(finding).toEqual({});
});

test('rating a photo looks at it before and after its file is rewritten', async () => {
  const library = launch(root, catalog, 60_000);
  const cache = thumbnailCache(path.join(cacheFolder, 'rating'));
  const [photo = ''] = photosIn(1);
  const calls = await callsOf(root, () => rateEntry({ cache, entryId: photo, library, stars: 3 }));
  expect(calls).toEqual({ lstat: 2, open: 1, realpath: 3, stat: 2 });
});

test('renaming looks at the entry and the new name once, and lists it after', async () => {
  const library = launch(root, catalog, 60_000);
  const [photo = ''] = photosIn(1).slice(1);
  const calls = await callsOf(root, () => renameEntry(library, photo, 'renamed.jpg'));
  expect(calls).toEqual({ lstat: 3, realpath: 2, rename: 1 });
});

test('the watcher looks at each changed path once, with its spelling', async () => {
  const library = launch(root, catalog, 60_000);
  const changed = photosIn(2).map((id) => ({ id, parentId: path.dirname(id) }));
  const calls = await callsOf(root, () => library.describeChanges(changed));
  expect(calls).toEqual({ lstat: changed.length, realpath: changed.length });
});

test("the share's check looks at the library's folder once", async () => {
  expect(await callsOf(root, () => createShareCheck(root)())).toEqual({ stat: 1 });
});

test("the watcher makes no look of its own, following the share's checks", async () => {
  const controller = new AbortController();
  const share = new Share(createShareCheck(root));
  // Starting to watch is Node's own work, which differs by system: on Linux, Node watches each
  // folder itself, reading every one. It does all of it inside `fs.watch`, before this returns,
  // so the count below sees only what follows.
  watchFolder({ report: () => null, root, share, signal: controller.signal });
  const calls = await callsOf(root, () => share.check());
  controller.abort();
  expect(calls).toEqual({ stat: 1 });
});

test("a run to Prism's Trash looks at each entry twice and moves it", async () => {
  const library = launch(root, catalog, 60_000);
  const targets = photosIn(3);
  const calls = await callsOf(root, async () => {
    // A clock that stands still, so the manifest is saved by its count of items alone.
    const batch = await PrismTrashBatch.open(root, { now: () => 0, top: root });
    await runTrashPlan(library, {
      destination: {
        batch: batch.dir,
        keepSaved: () => batch.keepSaved(),
        kind: 'prism',
        put: (file) => batch.put(file),
      },
      onProgress: () => null,
      plan: trashPlan(targets),
    });
  });
  // Per entry: its folder's real path and a look, for the volume check and again to move it, and
  // the move. Once for the run: the top's real path, its volume, a look for a free batch name, the
  // batch and the one folder its entries go in, and the manifest saved at the end, as the run has
  // fewer than 100 entries.
  const count = targets.length;
  expect(calls).toEqual({
    lstat: 2 * count + 2,
    mkdir: 2,
    realpath: 2 * count + 1,
    rename: count,
    writeFile: 1,
  });
});

test('deleting for good looks at each entry three times and deletes it', async () => {
  const library = launch(root, catalog, 60_000);
  const targets = photosIn(3).map((id) => id.replace('top-0', 'top-1'));
  const calls = await callsOf(root, async () => {
    await runTrashPlan(library, {
      destination: await deleteForGood(root),
      onProgress: () => null,
      plan: trashPlan(targets),
    });
  });
  // Per entry: its folder's real path and a look, for the volume check and again to delete it,
  // then a last look for its volume as it is deleted. Once: the library's volume, twice.
  const count = targets.length;
  expect(calls).toEqual({ lstat: 3 * count + 2, realpath: 2 * count, unlink: count });
});
