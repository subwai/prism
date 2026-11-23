import { AHEAD_ROWS } from '#photos/worker/on-screen/nearest-first';
import { LatestScreenContents } from '#photos/worker/on-screen/screen-contents';
import { ThumbnailsAhead } from '#photos/worker/on-screen/thumbnails-ahead';
import type { CurrentPriority } from '#photos/worker/scheduler/scheduler';
import type { KnownItem, ViewFile } from '@prism/catalog';
import type { ThumbnailResult } from '@prism/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

function photo(id: string, inode: string | null): KnownItem {
  return { id, inode, kind: 'image', modifiedMs: 1000, size: 10 };
}

/** A folder whose tile shows `cover` first. */
function folder(id: string, cover: KnownItem): ViewFile {
  return { cover, id, inode: '0', kind: 'directory', modifiedMs: 1, size: 0 };
}

/** Thumbnails ahead of `files`, the one view the window shows, none of them cached. */
async function ahead(
  files: ViewFile[],
  makes = () => Promise.resolve<ThumbnailResult>({ status: 'ready', url: '' }),
) {
  const root = await mkdtemp(path.join(tmpdir(), 'thumbnails-ahead-'));
  const controller = new AbortController();
  onTestFinished(async () => {
    controller.abort();
    await rm(root, { force: true, recursive: true });
  });
  const screen = new LatestScreenContents();
  const made: { id: string; priority: CurrentPriority }[] = [];
  // As the catalog answers: all of a view under the limit, or else the rows asked for.
  const viewFiles = vi.fn((_viewId: string, start: number, end: number, limit: number) => {
    const whole = files.length < limit;
    const from = whole ? 0 : Math.max(0, start);
    const read = whole ? files : files.slice(from, Math.max(from, end));
    return Promise.resolve({ files: read, start: from, whole });
  });
  const thumbnails = new ThumbnailsAhead({
    makeThumbnail: (id, _key, priority) => {
      made.push({ id, priority });
      return makes();
    },
    root,
    screen,
    signal: controller.signal,
    viewFiles,
  });
  /** Says the window shows rows `start` up to `end` of the view, and plans again. */
  const show = (start: number, end: number) => {
    screen.update({
      foldersToRead: [],
      shown: [],
      views: [{ end, start, viewId: 'view' }],
    });
    thumbnails.plan();
  };
  return { made, show, thumbnails, viewFiles };
}

test("a small view has every thumbnail made, folders' covers too, nearest to the rows on screen first", async () => {
  // Each its own file, as the inode names its thumbnail.
  const files: ViewFile[] = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'].map((id, index) =>
    photo(id, String(index)),
  );
  files.splice(1, 0, folder('Trips', photo('Trips/beach.jpg', '9')));
  // Listed before the catalog kept inodes, and a folder whose tile is not worked out: made once
  // on screen.
  files.push(photo('unlisted.jpg', null), { ...folder('New', photo('', null)), cover: undefined });
  const { made, show } = await ahead(files);
  show(3, 4);
  await vi.waitFor(() => expect(made).toHaveLength(6));
  expect(made.map(({ id }) => id)).toEqual([
    'c.jpg',
    'd.jpg',
    'b.jpg',
    'e.jpg',
    'Trips/beach.jpg',
    'a.jpg',
  ]);
  expect(made[0]?.priority()).toBe('ahead');
});

test('a large view has only the covers of the folders near its scroll made, read as it scrolls', async () => {
  const files: ViewFile[] = Array.from({ length: AHEAD_ROWS * 2 }, (_file, index) =>
    index % 10 === 0
      ? folder(`folder ${index}`, photo(`folder ${index}/cover.jpg`, `c${index}`))
      : photo(`${index}.jpg`, String(index)),
  );
  const { made, show, viewFiles } = await ahead(files);
  show(1000, 1010);
  // Rows 500 up to 1510, of which every tenth is a folder.
  await vi.waitFor(() => expect(made).toHaveLength(101));
  // Only the rows within half the limit of those on screen are read, never the whole view.
  expect(viewFiles).toHaveBeenLastCalledWith('view', 500, 1510, AHEAD_ROWS);
  expect(made.slice(0, 3).map(({ id }) => id)).toEqual([
    'folder 1000/cover.jpg',
    'folder 1010/cover.jpg',
    'folder 990/cover.jpg',
  ]);
  expect(made.every(({ id }) => id.endsWith('/cover.jpg'))).toBe(true);
  show(1500, 1510);
  await vi.waitFor(() =>
    expect(viewFiles).toHaveBeenLastCalledWith('view', 1000, 2010, AHEAD_ROWS),
  );
});

test('a new plan drops the last one’s thumbnails, and leaves those that cannot be made', async () => {
  const files = ['a.mp4', 'b.mp4', 'c.mp4'].map((id, index) => photo(id, String(index)));
  // Videos only the window can take a still image of.
  const { made, show } = await ahead(files, () => Promise.reject(new Error('Frame needed.')));
  show(0, 1);
  await vi.waitFor(() => expect(made).toHaveLength(3));
  const [first] = made;
  show(2, 3);
  expect(first?.priority()).toBeNull();
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(made).toHaveLength(3);
});

test("a view's files are read once as it scrolls, and again once it changes", async () => {
  const files = ['a.jpg', 'b.jpg'].map((id, index) => photo(id, String(index)));
  const { made, show, thumbnails, viewFiles } = await ahead(files);
  show(0, 1);
  await vi.waitFor(() => expect(made).toHaveLength(2));
  show(1, 2);
  await vi.waitFor(() => expect(made).toHaveLength(4));
  expect(viewFiles).toHaveBeenCalledOnce();
  thumbnails.viewChanged('view');
  await vi.waitFor(() => expect(viewFiles).toHaveBeenCalledTimes(2));
});

test('only the latest ten thousand thumbnails that could not be made are skipped by a new plan', async () => {
  // Views just small enough to have all their thumbnails made ahead, of videos only the window
  // can take a still image of. Each view's files are new ones, so their thumbnails are too.
  const rows = AHEAD_ROWS - 1;
  const viewOf = (view: number) =>
    Array.from({ length: rows }, (_row, index) =>
      photo(`view${view}-${index}.mp4`, String(view * AHEAD_ROWS + index)),
    );
  const files = viewOf(0);
  const { made, show, thumbnails } = await ahead(files, () =>
    Promise.reject(new Error('Frame needed.')),
  );
  const madeOf = (view: number) => made.filter(({ id }) => id.startsWith(`view${view}-`)).length;
  show(0, 1);
  await vi.waitFor(() => expect(madeOf(0)).toBe(rows));
  for (let view = 1; view <= 10; view += 1) {
    files.splice(0, files.length, ...viewOf(view));
    thumbnails.viewChanged('view');
    await vi.waitFor(() => expect(madeOf(view)).toBe(rows), { timeout: 10_000 });
  }
  // 11 views of 999 failed, past the 10,000 kept: the latest view's are skipped, and the first
  // view's, forgotten, are tried again.
  const showAgain = (view: number) => {
    files.splice(0, files.length, ...viewOf(view));
    thumbnails.viewChanged('view');
  };
  showAgain(10);
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(madeOf(10)).toBe(rows);
  showAgain(0);
  await vi.waitFor(() => expect(madeOf(0)).toBe(2 * rows), { timeout: 10_000 });
}, 60_000);
