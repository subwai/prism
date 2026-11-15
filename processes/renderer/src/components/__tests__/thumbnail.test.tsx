import { renderInLibrary } from '#components/__tests__/render';
import { Thumbnail } from '#components/thumbnail';
import { fakeAPI, photo, tellThumbnail } from '#data/__tests__/fixtures';
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

/** Waits for the window to say it shows `entry`, as a tile whose cached thumbnail is missing does. */
async function shown(api: ReturnType<typeof fakeAPI>) {
  await expect
    .poll(() => api.attend.mock.calls.some(([attention]) => attention.shown.includes(entry.id)))
    .toBe(true);
}

test('a thumbnail shows the cached one on its first frame', async () => {
  const api = fakeAPI([]);
  const { screen } = await renderInLibrary(<Thumbnail entry={entry} />, { api });
  const image = screen.container.querySelector('img');
  expect(image?.getAttribute('src')).toBe(cachedThumbnailURL('test', entry));
});

test('a thumbnail that is not cached shows once the worker tells of it', async () => {
  const api = fakeAPI([]);
  const url = await madeThumbnail();
  const { screen } = await renderInLibrary(<Thumbnail entry={entry} />, { api });
  // The tests serve no `media:` URLs, so the cached one fails to load, as one not made yet does.
  await shown(api);
  tellThumbnail(api, { entryId: entry.id, status: 'ready', url });
  await expect.poll(() => screen.container.querySelector('img')?.getAttribute('src')).toBe(url);
  await expect.element(screen.container.querySelector('img')).toBeVisible();
});

test('a thumbnail that could not be made shows as missing', async () => {
  const api = fakeAPI([]);
  const { screen } = await renderInLibrary(<Thumbnail entry={entry} />, { api });
  await shown(api);
  tellThumbnail(api, { entryId: entry.id, message: 'Unreadable.', status: 'failed' });
  await expect.poll(() => screen.container.querySelector('svg.lucide-image-off')).not.toBeNull();
});

test('a thumbnail that fails to load is never shown broken', async () => {
  const api = fakeAPI([]);
  // Made, but gone since, as one the cache trimmed.
  const url = 'media://thumbnail/gone.webp';
  const { screen } = await renderInLibrary(<Thumbnail entry={entry} />, { api });
  await shown(api);
  tellThumbnail(api, { entryId: entry.id, status: 'ready', url });
  await expect.poll(() => screen.container.querySelector('img')?.getAttribute('src')).toBe(url);
  await expect.element(screen.container.querySelector('img')).not.toBeVisible();
});
