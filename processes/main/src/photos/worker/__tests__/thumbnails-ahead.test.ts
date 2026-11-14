import { WindowAttention } from '#photos/worker/attention';
import type { Want } from '#photos/worker/scheduler';
import { ThumbnailsAhead } from '#photos/worker/thumbnails-ahead';
import type { KnownItem } from '@prism/catalog';
import { thumbnailCache } from '@prism/media';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test, vi } from 'vitest';

function photo(id: string, inode: string | null): KnownItem {
  return { id, inode, kind: 'image', modifiedMs: 1000, size: 10 };
}

/** Thumbnails ahead of `files`, the one view the window shows, none of them cached. */
async function ahead(files: KnownItem[], makes = () => Promise.resolve()) {
  const root = await mkdtemp(path.join(tmpdir(), 'thumbnails-ahead-'));
  const controller = new AbortController();
  onTestFinished(async () => {
    controller.abort();
    await rm(root, { force: true, recursive: true });
  });
  const attention = new WindowAttention();
  const made: { id: string; wants: Want }[] = [];
  const thumbnails = new ThumbnailsAhead({
    attention,
    cache: thumbnailCache(path.join(root, 'cache')),
    make: (id, _key, wants) => {
      made.push({ id, wants });
      return makes();
    },
    root,
    signal: controller.signal,
    viewFiles: () => Promise.resolve(files),
  });
  /** Says the window shows rows `start` up to `end` of the view, and plans again. */
  const show = (start: number, end: number) => {
    attention.update({ shown: [], tiles: [], views: [{ end, start, viewId: 'view' }] });
    thumbnails.replan();
  };
  return { made, show, thumbnails };
}

test('a small view has every thumbnail made, nearest to the rows on show first', async () => {
  // Each its own file, as the inode names its thumbnail.
  const files = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'].map((id, index) =>
    photo(id, String(index)),
  );
  files.splice(1, 0, { id: 'folder', inode: '1', kind: 'directory', modifiedMs: 1, size: 0 });
  // Listed before the catalog kept inodes: the window asks for it once on show.
  files.push(photo('unlisted.jpg', null));
  const { made, show } = await ahead(files);
  show(3, 4);
  await vi.waitFor(() => expect(made).toHaveLength(5));
  expect(made.map(({ id }) => id)).toEqual(['c.jpg', 'd.jpg', 'b.jpg', 'e.jpg', 'a.jpg']);
  expect(made[0]?.wants()).toBe('ahead');
});

test('a view of a thousand rows or more has none made ahead of its scroll', async () => {
  const files = Array.from({ length: 1000 }, (_file, index) =>
    photo(`${index}.jpg`, String(index)),
  );
  const { made, show } = await ahead(files);
  show(0, 10);
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(made).toEqual([]);
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
