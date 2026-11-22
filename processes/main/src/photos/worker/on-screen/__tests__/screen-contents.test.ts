import { openWindow } from '#photos/worker/__tests__/window';
import { PhotoLibrary } from '#photos/worker/library';
import { LIMITS } from '#photos/worker/scheduler/limits';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import sharp from 'sharp';
import { expect, onTestFinished, test, vi } from 'vitest';

/** A library of two photos, whose decodes are all taken until `free` is called. */
async function busyLibrary() {
  const root = await mkdtemp(path.join(tmpdir(), 'screen-contents-'));
  for (const name of ['a.png', 'b.png']) {
    await sharp({ create: { background: '#4678ab', channels: 3, height: 60, width: 80 } })
      .png()
      .toFile(path.join(root, name));
  }
  const library = PhotoLibrary.open(await realpath(root));
  onTestFinished(async () => {
    await library.close();
    await rm(root, { force: true, recursive: true });
  });
  await library.readFolder('.');
  const window = openWindow(library, path.join(root, 'cache'));
  const decodes = Promise.withResolvers<null>();
  for (let index = 0; index < LIMITS.thumbnail.visible; index += 1) {
    library.scheduler
      .run(
        'thumbnail',
        `busy ${index}`,
        () => 'visible',
        () => decodes.promise,
      )
      .catch(() => null);
  }
  await setImmediate();
  return { ...window, free: () => decodes.resolve(null) };
}

test('the thumbnail of an entry on show is made in its turn and told of', async () => {
  const { show, told, free } = await busyLibrary();
  const made = told('a.png');
  await show(['a.png']);
  free();
  await expect(made).resolves.toMatchObject({ status: 'ready' });
});

test('a thumbnail the window stops showing before its turn is dropped, and made once on show again', async () => {
  const { show, told, free } = await busyLibrary();
  const left = vi.fn();
  told('a.png').then(left, left);
  const kept = told('b.png');
  await show(['a.png', 'b.png']);
  await show(['b.png']);
  free();
  await expect(kept).resolves.toMatchObject({ status: 'ready' });
  expect(left).not.toHaveBeenCalled();
  const back = told('a.png');
  await show(['a.png']);
  await expect(back).resolves.toMatchObject({ status: 'ready' });
});
