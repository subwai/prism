import { createShareCheck, Share } from '#photos/worker/disk/share/share';
import { Scheduler } from '#photos/worker/scheduler/scheduler';
import { DetailsReader } from '#photos/worker/views/details-reader';
import type { Catalog, CatalogWrite, UnreadPhoto } from '@prism/catalog';
import { getEventListeners } from 'node:events';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, onTestFinished, test } from 'vitest';

/** A photo the catalog wants read, listed at this size and time. */
function unread(id: string, entry = 1): UnreadPhoto {
  return { entry, id, modifiedMs: 1000, size: 50 };
}

/**
 * A details reader of the library at `root`, over a catalog that wants `photos` read once, then
 * nothing, which notes what it is sent.
 */
function detailsReader(root = '/nowhere', photos = [unread('a.jpg')]) {
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  let asked = 0;
  const written: CatalogWrite[] = [];
  const skipped: number[][] = [];
  const catalog = {
    call(method: string, ...args: unknown[]) {
      asked += method === 'photosToRead' ? 1 : 0;
      if (method === 'skip') {
        skipped.push(args[0] as number[]);
      }
      if (method === 'reuseDetails') {
        return Promise.resolve((args[0] as { id: string }[]).map(({ id }) => id));
      }
      return Promise.resolve(method === 'photosToRead' && asked === 1 ? photos : []);
    },
    write(write: CatalogWrite) {
      written.push(write);
    },
  } as unknown as Catalog;
  const scheduler = new Scheduler(controller.signal);
  const share = new Share(createShareCheck(root));
  const reader = new DetailsReader({ catalog, root, scheduler, share, signal: controller.signal });
  reader.start();
  /** Waits for the details reader to have asked for photos again, having done with the first. */
  const done = async () => {
    await expect.poll(() => asked, { timeout: 5000 }).toBeGreaterThan(1);
    return { skipped, written };
  };
  return { controller, done, reader, scheduler };
}

async function library() {
  const root = await mkdtemp(path.join(tmpdir(), 'details-reader-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  return root;
}

test('photos whose files cannot be read are kept as unreadable, at the file as it failed', async () => {
  const root = await library();
  // Looked at, but not read, as a folder named like a photo.
  await mkdir(path.join(root, 'folder.jpg'));
  const looked = await stat(path.join(root, 'folder.jpg'));
  const { done } = detailsReader(root, [unread('gone.jpg', 1), unread('folder.jpg', 2)]);
  const { skipped, written } = await done();
  expect(skipped).toEqual([]);
  const marked = written.flatMap((write) => (write.kind === 'markUnreadable' ? write.files : []));
  expect(marked).toHaveLength(2);
  // Gone, it is kept as listed; there, at the size and time it was looked at with.
  expect(marked).toContainEqual(expect.objectContaining({ id: 'gone.jpg', modifiedMs: 1000 }));
  expect(marked).toContainEqual(
    expect.objectContaining({ id: 'folder.jpg', modifiedMs: looked.mtimeMs, size: looked.size }),
  );
});

test('photos of a library whose folder cannot be reached are only skipped for now', async () => {
  const { done } = detailsReader(path.join(await library(), 'offline'));
  const { skipped, written } = await done();
  expect(written.some((write) => write.kind === 'markUnreadable')).toBe(false);
  expect(skipped).toEqual([[1]]);
});

test('waiting for thumbnails to make way leaves no listeners behind', async () => {
  const { controller, scheduler } = detailsReader();
  // A thumbnail on show that takes its time, which background reads make way for.
  const made = Promise.withResolvers<null>();
  scheduler
    .run(
      'thumbnail',
      'on show',
      () => 'visible',
      () => made.promise,
    )
    .catch(() => null);
  await delay(300);
  expect(getEventListeners(controller.signal, 'abort').length).toBeLessThanOrEqual(2);
  made.resolve(null);
});

test('waiting for more photos to read leaves no listeners behind', async () => {
  const { controller, reader } = detailsReader();
  for (let nudge = 0; nudge < 20; nudge += 1) {
    reader.wake();
    await delay(5);
  }
  expect(getEventListeners(controller.signal, 'abort').length).toBeLessThanOrEqual(2);
});
