import { ReportedAttention } from '#photos/worker/attention';
import type { Want } from '#photos/worker/scheduler';
import { AHEAD_ROWS } from '#photos/worker/scheduling';
import { ThumbnailsAhead } from '#photos/worker/thumbnails-ahead';
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
  const attention = new ReportedAttention();
  const made: { id: string; wants: Want }[] = [];
  // As the catalog answers: all of a view under the limit, or else the rows asked for.
  const viewFiles = vi.fn((_viewId: string, start: number, end: number, limit: number) => {
    const whole = files.length < limit;
    const from = whole ? 0 : Math.max(0, start);
    const read = whole ? files : files.slice(from, Math.max(from, end));
    return Promise.resolve({ files: read, start: from, whole });
  });
  const thumbnails = new ThumbnailsAhead({
    attention,
    make: (id, _key, wants) => {
      made.push({ id, wants });
      return makes();
    },
    root,
    signal: controller.signal,
    viewFiles,
  });
  /** Says the window shows rows `start` up to `end` of the view, and plans again. */
  const show = (start: number, end: number) => {
    attention.update({
      foldersToRead: [],
      shown: [],
      views: [{ end, start, viewId: 'view' }],
    });
    thumbnails.replan();
  };
  return { made, show, thumbnails, viewFiles };
}

test("a small view has every thumbnail made, folders' covers too, nearest to the rows on show first", async () => {
  // Each its own file, as the inode names its thumbnail.
  const files: ViewFile[] = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'].map((id, index) =>
    photo(id, String(index)),
  );
  files.splice(1, 0, folder('Trips', photo('Trips/beach.jpg', '9')));
  // Listed before the catalog kept inodes, and a folder whose tile is not worked out: made once
  // on show.
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
  expect(made[0]?.wants()).toBe('ahead');
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
  // Only the rows within half the limit of those on show are read, never the whole view.
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
  // Videos only the window can take a still of.
  const { made, show } = await ahead(files, () => Promise.reject(new Error('Frame needed.')));
  show(0, 1);
  await vi.waitFor(() => expect(made).toHaveLength(3));
  const [first] = made;
  show(2, 3);
  expect(first?.wants()).toBeNull();
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
  thumbnails.changed('view');
  await vi.waitFor(() => expect(viewFiles).toHaveBeenCalledTimes(2));
});
