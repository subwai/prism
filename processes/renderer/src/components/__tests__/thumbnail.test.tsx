import { renderInLibrary } from '#components/__tests__/render';
import { Thumbnail } from '#components/thumbnail';
import { fakeAPI, photo } from '#data/__tests__/fixtures';
import { cachedThumbnailURL } from '@prism/shared';
import { expect, test } from 'vitest';

/** A small image the window can load, as a thumbnail the worker made. */
async function madeThumbnail() {
  const canvas = new OffscreenCanvas(40, 30);
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'seagreen';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return URL.createObjectURL(await canvas.convertToBlob());
}

const entry = { ...photo, metadata: { accessedMs: 0, createdMs: 0, modifiedMs: 2, size: 1 } };

test('a thumbnail shows the cached one on its first frame, asking for none', async () => {
  const api = fakeAPI([]);
  // Never answered, so nothing but the cached thumbnail could show.
  api.requestThumbnail.mockReturnValue(
    new Promise(() => {
      /* Never settles. */
    }),
  );
  const { screen } = await renderInLibrary(<Thumbnail entry={entry} />, { api });
  const image = screen.container.querySelector('img');
  expect(image?.getAttribute('src')).toBe(cachedThumbnailURL('test', entry));
  expect(api.requestThumbnail).not.toHaveBeenCalled();
});

test('a thumbnail that is not cached is made instead', async () => {
  const api = fakeAPI([]);
  const url = await madeThumbnail();
  api.requestThumbnail.mockResolvedValue({ status: 'ready', url });
  const { screen } = await renderInLibrary(<Thumbnail entry={entry} />, { api });
  // The tests serve no `media:` URLs, so the cached one fails to load, as one not made yet does.
  await expect.poll(() => screen.container.querySelector('img')?.getAttribute('src')).toBe(url);
  expect(api.requestThumbnail).toHaveBeenCalledExactlyOnceWith(entry.id);
});
