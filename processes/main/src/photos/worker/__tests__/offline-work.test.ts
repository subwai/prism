import { folder } from '#photos/worker/__tests__/launches';
import { openWindow } from '#photos/worker/__tests__/window';
import { PhotoLibrary } from '#photos/worker/library';
import { Share, type ShareState } from '#photos/worker/share/share';
import type { ThumbnailResult } from '@prism/shared';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test, vi } from 'vitest';

/** A library holding `photo.png`, read once, on a share that is as `share.state` says. */
async function library() {
  const root = await folder('offline-work-');
  await sharp({ create: { background: '#4678ab', channels: 3, height: 60, width: 80 } })
    .png()
    .toFile(path.join(root, 'photo.png'));
  const share = { state: 'online' as ShareState };
  const opened = PhotoLibrary.open(
    root,
    undefined,
    undefined,
    Date.now,
    new Share(() => Promise.resolve(share.state)),
  );
  onTestFinished(() => opened.close());
  await opened.readFolder('.');
  const cache = await folder('offline-work-cache-');
  return { library: opened, root, share, ...openWindow(opened, cache) };
}

test('a thumbnail asked for while the share is offline is made once it is back, not told as failed', async () => {
  const { library: photos, root, share, show, told } = await library();
  await rename(root, `${root}-away`);
  share.state = 'offline';
  await photos.share.check();
  const news: ThumbnailResult[] = [];
  told('photo.png').then((result) => news.push(result));
  await show(['photo.png']);
  await vi.waitFor(() => expect(photos.scheduler.jobCounts().thumbnail.waiting).toBe(1));
  expect(news).toEqual([]);
  await rename(`${root}-away`, root);
  share.state = 'online';
  await photos.share.check();
  await expect.poll(() => news).toEqual([expect.objectContaining({ status: 'ready' })]);
});

test('an original asked for while the share is offline says so at once', async () => {
  const { backend, library: photos, share } = await library();
  share.state = 'offline';
  await photos.share.check();
  await expect(backend.original('photo.png')).rejects.toThrow(
    'The share this library is on is offline.',
  );
  await expect(backend.convertedOriginal('photo.png')).rejects.toThrow(
    'The share this library is on is offline.',
  );
});

test('what the library is busy with says while the share is offline', async () => {
  const { library: photos, share } = await library();
  const heard: boolean[] = [];
  photos.activity.onChange(() => heard.push(photos.activity.current().offline));
  share.state = 'offline';
  await photos.share.check();
  expect(heard).toContain(true);
  expect(photos.activity.current().offline).toBe(true);
  share.state = 'online';
  await photos.share.check();
  expect(heard.at(-1)).toBe(false);
});
