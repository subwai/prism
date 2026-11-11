import { renderInLibrary } from '#components/__tests__/render';
import { ImageViewer } from '#components/viewer/image-viewer';
import { fakeAPI } from '#data/__tests__/fixtures';
import type { PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

const photo: PhotoEntry = { id: 'photo.png', kind: 'image', name: 'photo.png', parentId: '.' };

/** A one-pixel PNG, so the photo loads without the app's protocol. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('clicking the photo takes focus from a field, such as the search', async () => {
  const api = fakeAPI([]);
  api.getOriginalURL.mockResolvedValue(PIXEL);
  const { screen } = await renderInLibrary(
    <div className="flex h-screen flex-col">
      <input aria-label="Search" />
      <ImageViewer browsing={{ count: 1, index: 0 }} selected={photo} />
    </div>,
    { api },
  );
  const search = screen.getByRole('textbox', { name: 'Search' });
  await userEvent.click(search);
  await expect.element(search).toHaveFocus();

  await expect.element(screen.getByRole('img', { name: 'photo.png' })).toBeVisible();
  const viewer = screen.getByRole('region', { name: 'Image preview' });
  await userEvent.click(viewer);
  await expect.element(viewer).toHaveFocus();
});

test('full screen covers the window, and Escape brings the viewer back', async () => {
  const api = fakeAPI([]);
  api.getOriginalURL.mockResolvedValue(PIXEL);
  const { screen } = await renderInLibrary(
    <div className="flex h-screen flex-col p-10">
      <ImageViewer browsing={{ count: 1, index: 0 }} selected={photo} />
    </div>,
    { api },
  );
  const viewer = screen.getByRole('region', { name: 'Image preview' });
  await expect.element(screen.getByRole('img', { name: 'photo.png' })).toBeVisible();
  const before = viewer.element().getBoundingClientRect();
  await userEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  await expect.element(viewer).toHaveAttribute('data-full-screen');
  const covered = viewer.element().getBoundingClientRect();
  expect([covered.left, covered.top, covered.width, covered.height]).toStrictEqual([
    0,
    0,
    window.innerWidth,
    window.innerHeight,
  ]);

  await userEvent.keyboard('{Escape}');
  await expect.element(viewer).not.toHaveAttribute('data-full-screen');
  await expect.element(screen.getByRole('button', { name: 'Full screen' })).toBeVisible();
  expect(viewer.element().getBoundingClientRect()).toStrictEqual(before);
});
