import { readFrame, receiveFrame } from '#photos/worker/frames';
import type { FrameRequest } from '@prism/shared';
import { getEventListeners } from 'node:events';
import { expect, test } from 'vitest';

/** A main process that answers every still asked of it at once, with `image`. */
function mainProcess(image: Uint8Array) {
  return {
    postMessage({ frame: { id } }: FrameRequest) {
      queueMicrotask(() => receiveFrame({ frame: { id, image } }));
    },
  };
}

test('a still the main process answered leaves nothing listening to the library', async () => {
  const library = new AbortController();
  const image = new Uint8Array([1, 2, 3]);
  const port = mainProcess(image);
  for (let still = 0; still < 20; still += 1) {
    await expect(
      readFrame(port, 'clip.mov', { height: 10, width: 10 }, library.signal),
    ).resolves.toBe(image);
  }
  expect(getEventListeners(library.signal, 'abort')).toHaveLength(0);
});

test('closing the library gives up on stills still asked for', async () => {
  const library = new AbortController();
  const still = readFrame(
    { postMessage: () => null },
    'clip.mov',
    { height: 10, width: 10 },
    library.signal,
  );
  library.abort(new Error('The library closed.'));
  await expect(still).rejects.toThrow('The library closed.');
});
