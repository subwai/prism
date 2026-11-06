import { renderInLibrary } from '#components/__tests__/render';
import { GalleryStatus } from '#components/gallery/gallery-status';
import type { ScanState } from '#data/directory-scan';
import { expect, test } from 'vitest';

function scanning(loading: boolean, sorting = false): ScanState {
  return { entries: [], error: null, errors: [], loading, sorting };
}

function status(scan: ScanState, count: number) {
  return (
    <GalleryStatus
      mode="filmstrip"
      pending={false}
      scan={scan}
      count={count}
      selected={null}
      size={160}
      onSize={() => null}
    />
  );
}

test('a scan that has found nothing yet says it is reading the folder', async () => {
  const { screen } = await renderInLibrary(status(scanning(true), 0));
  await expect.element(screen.getByText('Reading folder…')).toBeVisible();
});

test('a scan counts what it has found so far', async () => {
  const { screen } = await renderInLibrary(status(scanning(true), 1234));
  await expect.element(screen.getByText('1,234 photos so far…')).toBeVisible();
});

test('a finished scan shows the total', async () => {
  const { screen } = await renderInLibrary(status(scanning(false), 1234));
  await expect.element(screen.getByText('1,234 photos', { exact: true })).toBeVisible();
});

test('a scan reading the metadata a sort needs says it is sorting', async () => {
  const { screen } = await renderInLibrary(status(scanning(false, true), 1234));
  await expect.element(screen.getByText('Sorting 1,234 photos…')).toBeVisible();
});
