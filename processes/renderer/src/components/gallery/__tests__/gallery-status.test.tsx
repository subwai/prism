import { renderInLibrary } from '#components/__tests__/render';
import { GalleryStatus } from '#components/gallery/gallery-status';
import { expect, test } from 'vitest';

function status(
  count: number,
  { loading = false, unread = 0, unsupported = 0, details = false } = {},
) {
  return (
    <GalleryStatus
      mode="filmstrip"
      pending={false}
      state={{ count, loading, unread, unsupported }}
      details={details}
      selected={null}
      size={160}
      onSize={() => null}
    />
  );
}

test('a view that has found nothing yet says it is reading the folder', async () => {
  const { screen } = await renderInLibrary(status(0, { loading: true }));
  await expect.element(screen.getByText('Reading folder…')).toBeVisible();
});

test('a view counts what it has found so far', async () => {
  const { screen } = await renderInLibrary(status(1234, { loading: true }));
  await expect.element(screen.getByText('1,234 photos so far…')).toBeVisible();
});

test('a view read to the end shows the total', async () => {
  const { screen } = await renderInLibrary(status(1234, { unread: 5 }));
  await expect.element(screen.getByText('1,234 photos', { exact: true })).toBeVisible();
});

test('a view whose order needs photos’ details says how many are still to read', async () => {
  const { screen } = await renderInLibrary(status(1234, { details: true, unread: 412_000 }));
  await expect
    .element(screen.getByText('1,234 photos · Reading photo details, 412,000 to go'))
    .toBeVisible();
});

test('a view says how many files it cannot show, as no view shows them', async () => {
  const { screen } = await renderInLibrary(status(1234, { unsupported: 1 }));
  await expect.element(screen.getByText('1,234 photos · 1 unsupported file')).toBeVisible();
});

test('a view counts its unsupported files as it reads', async () => {
  const { screen } = await renderInLibrary(status(1234, { loading: true, unsupported: 37 }));
  await expect
    .element(screen.getByText('1,234 photos · 37 unsupported files so far…'))
    .toBeVisible();
});
