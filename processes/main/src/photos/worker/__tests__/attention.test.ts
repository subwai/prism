import { WorkerBackend } from '#photos/worker/backend';
import { PhotoLibrary } from '#photos/worker/library';
import { LIMITS } from '#photos/worker/scheduling';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import sharp from 'sharp';
import { expect, onTestFinished, test } from 'vitest';

/** A library of two photos, whose decodes are all taken until `free` is called. */
async function busyLibrary() {
  const root = await mkdtemp(path.join(tmpdir(), 'attention-'));
  for (const name of ['a.png', 'b.png']) {
    await sharp({ create: { background: '#4678ab', channels: 3, height: 60, width: 80 } })
      .png()
      .toFile(path.join(root, name));
  }
  const library = await PhotoLibrary.open(root);
  onTestFinished(async () => {
    await library.close();
    await rm(root, { force: true, recursive: true });
  });
  await library.listFolder('.');
  const backend = new WorkerBackend(library, path.join(root, 'cache'));
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
  return { backend, free: () => decodes.resolve(null) };
}

function onShow(shown: string[]) {
  return { shown, tiles: [], views: [] };
}

test('a thumbnail the window stops showing before its turn is dropped', async () => {
  const { backend, free } = await busyLibrary();
  const left = backend.requestThumbnail('a.png');
  const kept = backend.requestThumbnail('b.png');
  await setImmediate();
  await backend.attend(onShow(['b.png']));
  await expect(left).resolves.toEqual({ status: 'dropped' });
  free();
  await expect(kept).resolves.toMatchObject({ status: 'ready' });
});

test('a thumbnail asked for before the window says it shows it waits for what it says', async () => {
  const { backend, free } = await busyLibrary();
  await backend.attend(onShow([]));
  // Asked for as it comes into view, which the window says a moment later.
  const asked = backend.requestThumbnail('a.png');
  await setImmediate();
  free();
  await expect(asked).resolves.toMatchObject({ status: 'ready' });
});
