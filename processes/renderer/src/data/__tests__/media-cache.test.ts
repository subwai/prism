import { fixture, photo, tellThumbnail } from './fixtures.ts';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock(import('#data/media/video-frame'), () => ({
  captureFrame: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

// A reset deletes the files the last news names, so showing one meanwhile would break it; the
// cached thumbnails on screen stay until their new URLs load.
test('what the worker tells of thumbnails is kept only for the entries on show or read', () => {
  const { api, library } = fixture([]);
  tellThumbnail(api, { entryId: 'a.jpg', status: 'ready', url: 'media://thumbnail/a' });
  expect(library.media.thumbnailResult('a.jpg')).toBeUndefined();
});

// A tile just off screen whose cached thumbnail failed hears of the one made ahead of the scroll,
// which the worker does not tell of again once it is on show.
test('a thumbnail a tile reads is kept while it is off screen', () => {
  const { api, library } = fixture([]);
  const heard = vi.fn();
  library.media.subscribeThumbnail('a.jpg', heard);
  tellThumbnail(api, { entryId: 'a.jpg', status: 'ready', url: 'media://thumbnail/a' });
  expect(library.media.thumbnailResult('a.jpg')).toMatchObject({ url: 'media://thumbnail/a' });
  expect(heard).toHaveBeenCalledOnce();
});

test('a video still is taken only once its entry is on show', async () => {
  const { api, library } = fixture([]);
  library.media.subscribeThumbnail('clip.webm', () => null);
  tellThumbnail(api, { entryId: 'clip.webm', status: 'frame-needed' });
  expect(library.media.thumbnailResult('clip.webm')).toBeUndefined();
  expect(api.getOriginalURL).not.toHaveBeenCalled();
  // The worker tells of it again as it comes on show, as it is still not cached.
  library.markEntryOnScreen('clip.webm');
  tellThumbnail(api, { entryId: 'clip.webm', status: 'frame-needed' });
  await expect
    .poll(() => library.media.thumbnailResult('clip.webm'))
    .toEqual({ status: 'ready', url: 'media://thumbnail/clip.webm' });
  expect(api.storeThumbnail).toHaveBeenCalledOnce();
});

test('news no tile reads any more is kept only for the latest entries', () => {
  const { api, library } = fixture([]);
  library.media.subscribeThumbnail('read.jpg', () => null);
  tellThumbnail(api, { entryId: 'read.jpg', status: 'ready', url: 'media://thumbnail/read' });
  for (let index = 0; index <= 10_000; index += 1) {
    const entryId = `${index}.jpg`;
    const stop = library.media.subscribeThumbnail(entryId, () => null);
    tellThumbnail(api, { entryId, status: 'ready', url: `media://thumbnail/${index}` });
    stop();
  }
  // 10,002 told, so the two oldest no tile reads are forgotten.
  expect(library.media.thumbnailResult('1.jpg')).toBeUndefined();
  expect(library.media.thumbnailResult('2.jpg')).toBeDefined();
  expect(library.media.thumbnailResult('10000.jpg')).toBeDefined();
  // Still read, as a tile on screen the whole time.
  expect(library.media.thumbnailResult('read.jpg')).toBeDefined();
});

test('refresh forgets what the worker told of thumbnails, under new cached URLs', async () => {
  const { api, library } = fixture([]);
  library.markEntryOnScreen(photo.id);
  tellThumbnail(api, { entryId: photo.id, status: 'ready', url: 'media://thumbnail/a' });
  expect(library.media.thumbnailResult(photo.id)).toMatchObject({ url: 'media://thumbnail/a' });
  const generation = library.media.getGeneration();
  await library.refresh();
  expect(library.media.getGeneration()).toBe(generation + 1);
  expect(library.media.thumbnailResult(photo.id)).toBeUndefined();
});

test('takes the still of a video the system cannot render, and stores it as its thumbnail', async () => {
  const { api, library } = fixture([]);
  library.markEntryOnScreen('clip.webm');
  tellThumbnail(api, { entryId: 'clip.webm', status: 'frame-needed' });
  await expect
    .poll(() => library.media.thumbnailResult('clip.webm'))
    .toEqual({ status: 'ready', url: 'media://thumbnail/clip.webm' });
  expect(api.getOriginalURL).toHaveBeenCalledWith('clip.webm');
  expect(api.storeThumbnail).toHaveBeenCalledWith({
    entryId: 'clip.webm',
    image: new Uint8Array([1, 2, 3]),
  });
});
