import { renderInLibrary } from '#components/__tests__/render';
import { PhotoPeek } from '#components/preview/photo-peek';
import { fakeAPI } from '#data/__tests__/fixtures';
import { HEIF_CODECS_MISSING, type PhotoEntry } from '@prism/shared';
import { expect, test } from 'vitest';

const photo: PhotoEntry = {
  id: 'IMG_0001.HEIC',
  kind: 'image',
  name: 'IMG_0001.HEIC',
  parentId: '.',
};

/** Shows `photo` on `platform`, where the system cannot read it. */
async function showUnreadable(platform: string) {
  const api = fakeAPI([]);
  api.getOriginalURL.mockRejectedValue(new Error(HEIF_CODECS_MISSING));
  const { screen } = await renderInLibrary(
    <PhotoPeek browsing={{ count: 1, index: 0 }} selected={photo} onClose={() => null} />,
    { api, platform },
  );
  await expect.element(screen.getByText('Unable to display this photo')).toBeVisible();
  return screen;
}

test('on Windows, a HEIC photo that cannot be shown points to the codecs it needs', async () => {
  const screen = await showUnreadable('win32');
  await expect.element(screen.getByText(HEIF_CODECS_MISSING)).toBeVisible();
});

test('elsewhere, a HEIC photo that cannot be shown says so as any photo does', async () => {
  const screen = await showUnreadable('darwin');
  await expect.element(screen.getByText(/unsupported format/u)).toBeVisible();
});
