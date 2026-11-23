import { readStillImage, receiveStillImage } from '#photos/worker/messages/still-images';
import type { StillImageRequest } from '@prism/shared';
import { getEventListeners } from 'node:events';
import { expect, test } from 'vitest';

/** A main process that answers every still image asked of it at once, with `image`. */
function mainProcess(image: Uint8Array) {
  return {
    postMessage({ stillImage: { id } }: StillImageRequest) {
      queueMicrotask(() =>
        receiveStillImage({ kind: 'stillImageResponse', stillImage: { id, image, kind: 'image' } }),
      );
    },
  };
}

test('a still image the main process answered leaves nothing listening to the library', async () => {
  const library = new AbortController();
  const image = new Uint8Array([1, 2, 3]);
  const port = mainProcess(image);
  for (let count = 0; count < 20; count += 1) {
    await expect(
      readStillImage(port, 'clip.mov', { height: 10, width: 10 }, library.signal),
    ).resolves.toBe(image);
  }
  expect(getEventListeners(library.signal, 'abort')).toHaveLength(0);
});

test('closing the library gives up on still images still asked for', async () => {
  const library = new AbortController();
  const stillImage = readStillImage(
    { postMessage: () => null },
    'clip.mov',
    { height: 10, width: 10 },
    library.signal,
  );
  library.abort(new Error('The library closed.'));
  await expect(stillImage).rejects.toThrow('The library closed.');
});
