import { renderInLibrary } from '#components/__tests__/render';
import { ScanProblems } from '#components/gallery/scan-problems';
import type { ReadError } from '@prism/shared';
import { queryOptions } from '@tanstack/react-query';
import { expect, test } from 'vitest';

/** A scan that could not read `count` items, which `errors` lists once asked. */
function failing(count: number) {
  const errors: ReadError[] = Array.from({ length: count }, (_unused, index) => ({
    entryId: `Trips/${index}.jpg`,
    message: `EACCES: permission denied ${index}`,
    path: `Trips/${index}.jpg`,
  }));
  return {
    errors: queryOptions({ queryFn: () => Promise.resolve(errors), queryKey: ['errors', count] }),
    scan: { error: null, errorCount: count },
  };
}

test('the banner can be dismissed', async () => {
  const { scan, errors } = failing(3);
  const { screen } = await renderInLibrary(
    <ScanProblems scan={scan} errors={errors} scanKey={{}} onRetry={() => null} />,
  );
  const banner = screen.getByText('3 items could not be read. The rest are shown below.');
  await expect.element(banner).toBeVisible();
  await screen.getByRole('button', { name: 'Dismiss' }).click();
  await expect.element(banner).not.toBeInTheDocument();
});

test('the details list every item that could not be read, however many', async () => {
  const { scan, errors } = failing(500);
  const { screen } = await renderInLibrary(
    <ScanProblems scan={scan} errors={errors} scanKey={{}} onRetry={() => null} />,
  );
  await screen.getByRole('button', { name: 'Show details' }).click();
  const sheet = screen.getByRole('dialog', { name: 'Could not be read' });
  await expect.element(sheet.getByText('Trips/0.jpg')).toBeVisible();
  await expect.element(sheet.getByText('EACCES: permission denied 0')).toBeVisible();
  // Only the rows in view are drawn.
  expect(sheet.getByRole('listitem').elements().length).toBeLessThan(100);
});
