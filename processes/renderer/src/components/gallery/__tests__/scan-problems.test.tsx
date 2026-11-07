import { renderInLibrary } from '#components/__tests__/render';
import { ScanProblems } from '#components/gallery/scan-problems';
import type { ScanState } from '#data/directory-scan';
import { expect, test } from 'vitest';

function failing(count: number): ScanState {
  return {
    entries: [],
    error: null,
    errors: Array.from({ length: count }, (_unused, index) => ({
      entryId: `Trips/${index}.jpg`,
      message: `EACCES: permission denied ${index}`,
      path: `Trips/${index}.jpg`,
    })),
    loading: false,
    sorting: false,
  };
}

test('the banner can be dismissed', async () => {
  const { screen } = await renderInLibrary(
    <ScanProblems scan={failing(3)} scanKey={{}} onRetry={() => null} />,
  );
  const banner = screen.getByText('3 items could not be read. The rest are shown below.');
  await expect.element(banner).toBeVisible();
  await screen.getByRole('button', { name: 'Dismiss' }).click();
  await expect.element(banner).not.toBeInTheDocument();
});

test('the details list every item that could not be read, however many', async () => {
  const { screen } = await renderInLibrary(
    <ScanProblems scan={failing(500)} scanKey={{}} onRetry={() => null} />,
  );
  await screen.getByRole('button', { name: 'Show details' }).click();
  const sheet = screen.getByRole('dialog', { name: 'Could not be read' });
  await expect.element(sheet.getByText('Trips/0.jpg')).toBeVisible();
  await expect.element(sheet.getByText('EACCES: permission denied 0')).toBeVisible();
  // Only the rows in view are drawn.
  expect(sheet.getByRole('listitem').elements().length).toBeLessThan(100);
});
