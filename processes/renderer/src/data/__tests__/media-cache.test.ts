import { fixture, photo, sendThumbnail } from './fixtures.ts';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock(import('#data/media/video-still-images'), () => ({
  captureStillImage: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

// A reset deletes the files the last results name, so showing one meanwhile would break it. The
// cached thumbnails on screen stay until their new URLs load.
test('thumbnail results from the worker are kept only for entries on screen or read', () => {
  const { api, library } = fixture([]);
  sendThumbnail(api, { entryId: 'a.jpg', status: 'ready', url: 'media://thumbnail/a' });
  expect(library.media.thumbnailResult('a.jpg')).toBeUndefined();
});

// A tile just off screen whose cached thumbnail failed gets the one made ahead of the scroll. The
// worker does not send it again once the tile is on screen.
test('a thumbnail a tile reads is kept while it is off screen', () => {
  const { api, library } = fixture([]);
  const listener = vi.fn();
  library.media.subscribeThumbnail('a.jpg', listener);
  sendThumbnail(api, { entryId: 'a.jpg', status: 'ready', url: 'media://thumbnail/a' });
  expect(library.media.thumbnailResult('a.jpg')).toMatchObject({ url: 'media://thumbnail/a' });
  expect(listener).toHaveBeenCalledOnce();
});

test("a video's still image is taken only once its entry is on screen", async () => {
  const { api, library } = fixture([]);
  library.media.subscribeThumbnail('clip.webm', () => null);
  sendThumbnail(api, { entryId: 'clip.webm', status: 'still-image-needed' });
  expect(library.media.thumbnailResult('clip.webm')).toBeUndefined();
  expect(api.getOriginalURL).not.toHaveBeenCalled();
  // The worker sends it again as it comes on screen, because it is still not cached.
  library.markEntryOnScreen('clip.webm');
  sendThumbnail(api, { entryId: 'clip.webm', status: 'still-image-needed' });
  await expect
    .poll(() => library.media.thumbnailResult('clip.webm'))
    .toEqual({ status: 'ready', url: 'media://thumbnail/clip.webm' });
  expect(api.storeThumbnail).toHaveBeenCalledOnce();
});

test('results no tile reads any more are kept only for the latest entries', () => {
  const { api, library } = fixture([]);
  library.media.subscribeThumbnail('read.jpg', () => null);
  sendThumbnail(api, { entryId: 'read.jpg', status: 'ready', url: 'media://thumbnail/read' });
  for (let index = 0; index <= 10_000; index += 1) {
    const entryId = `${index}.jpg`;
    const stop = library.media.subscribeThumbnail(entryId, () => null);
    sendThumbnail(api, { entryId, status: 'ready', url: `media://thumbnail/${index}` });
    stop();
  }
  // 10,002 sent, so the two oldest that no tile reads are forgotten.
  expect(library.media.thumbnailResult('1.jpg')).toBeUndefined();
  expect(library.media.thumbnailResult('2.jpg')).toBeDefined();
  expect(library.media.thumbnailResult('10000.jpg')).toBeDefined();
  // Still read, as a tile on screen the whole time.
  expect(library.media.thumbnailResult('read.jpg')).toBeDefined();
});

test('refresh forgets the thumbnail results from the worker, under new cached URLs', async () => {
  const { api, library } = fixture([]);
  library.markEntryOnScreen(photo.id);
  sendThumbnail(api, { entryId: photo.id, status: 'ready', url: 'media://thumbnail/a' });
  expect(library.media.thumbnailResult(photo.id)).toMatchObject({ url: 'media://thumbnail/a' });
  const generation = library.media.getGeneration();
  await library.refresh();
  expect(library.media.getGeneration()).toBe(generation + 1);
  expect(library.media.thumbnailResult(photo.id)).toBeUndefined();
});

test('takes the still image of a video the system cannot render, and stores it as its thumbnail', async () => {
  const { api, library } = fixture([]);
  library.markEntryOnScreen('clip.webm');
  sendThumbnail(api, { entryId: 'clip.webm', status: 'still-image-needed' });
  await expect
    .poll(() => library.media.thumbnailResult('clip.webm'))
    .toEqual({ status: 'ready', url: 'media://thumbnail/clip.webm' });
  expect(api.getOriginalURL).toHaveBeenCalledWith('clip.webm');
  expect(api.storeThumbnail).toHaveBeenCalledWith({
    entryId: 'clip.webm',
    image: new Uint8Array([1, 2, 3]),
  });
});
