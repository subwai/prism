import { WorkerBackend } from '#photos/worker/backend';
import { PhotoLibrary } from '#photos/worker/library';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { expect, onTestFinished, test, vi } from 'vitest';

async function library(files: Record<string, string | Buffer>) {
  const root = await mkdtemp(path.join(tmpdir(), 'photo-covers-'));
  onTestFinished(() => rm(root, { force: true, recursive: true }));
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(root, name), contents);
  }
  const opened = await PhotoLibrary.open(root);
  onTestFinished(() => opened.close());
  return { library: opened, root };
}

function picture(channels: 3 | 4) {
  const background = channels === 4 ? 'rgba(0, 0, 0, 0)' : '#4678ab';
  return sharp({ create: { background, channels, height: 60, width: 80 } })
    .png()
    .toBuffer();
}

test('a folder with photos and videos takes a photo as its cover', async () => {
  const { library: photos } = await library({
    'a clip.mp4': 'video',
    'b photo.png': await picture(3),
    'c clip.mp4': 'video',
  });
  const { covers } = await photos.inspectFolder('.');
  expect(covers.map((cover) => cover.id)).toEqual([
    'b photo.png',
    ...['a clip.mp4', 'c clip.mp4'].filter((id) => covers.some((cover) => cover.id === id)),
  ]);
  expect(covers).toHaveLength(3);
});

test('an icon from the system thumbnailer sends the video to the window instead', async () => {
  const { library: videos, root } = await library({ 'broken.mp4': 'not a video' });
  const icon = await picture(4);
  const backend = new WorkerBackend(
    videos,
    path.join(root, 'cache'),
    vi.fn(() => Promise.resolve(icon)),
  );
  await expect(backend.requestThumbnail('broken.mp4')).resolves.toEqual({
    status: 'frame-needed',
  });
});
