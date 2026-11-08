import { renderInLibrary } from '#components/__tests__/render';
import { PhotoPeek } from '#components/preview/photo-peek';
import { fakeAPI } from '#data/__tests__/fixtures';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

/** A second of video, recorded from a canvas, so the player shows its controls. */
async function recordVideo() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
  const stopped = new Promise((resolve) => {
    recorder.addEventListener('stop', resolve);
  });
  recorder.start();
  const started = performance.now();
  while (performance.now() - started < 1000) {
    if (context) {
      context.fillStyle = `hsl(${performance.now() % 360} 60% 50%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    await new Promise(requestAnimationFrame);
  }
  recorder.stop();
  await stopped;
  return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
}

const video: PhotoEntry = { id: 'clip.webm', kind: 'video', name: 'clip.webm', parentId: '.' };

test('the controls and the pointer hide while the pointer rests, and come back', async () => {
  const api = fakeAPI([]);
  api.getOriginalURL.mockResolvedValue(await recordVideo());
  const { screen } = await renderInLibrary(
    <PhotoPeek browsing={{ count: 1, index: 0 }} selected={video} onClose={() => null} />,
    { api },
  );
  const viewer = screen.getByRole('region', { name: 'Image preview' });
  const playback = screen.getByRole('group', { name: 'Video controls' });
  const toolbars = [screen.getByRole('group', { name: 'Photo controls' }), playback];
  // Each toolbar fades as a whole, around it.
  const opacities = () =>
    toolbars.map((toolbar) => getComputedStyle(toolbar.element().parentElement as Element).opacity);
  await userEvent.hover(viewer.getByLabelText('clip.webm'));
  await expect.poll(opacities).toEqual(['1', '1']);
  await expect.poll(opacities, { timeout: 4000 }).toEqual(['0', '0']);
  expect(getComputedStyle(viewer.element()).cursor).toBe('none');
  // Pointing at a toolbar brings it all back.
  await userEvent.hover(playback);
  await expect.poll(opacities).toEqual(['1', '1']);
});
