import { renderInLibrary } from '#components/__tests__/render';
import { Toolbar } from '#components/gallery/toolbar';
import type { PhotoEntry } from '@prism/shared';
import { useSearchParams } from 'react-router';
import { expect, test } from 'vitest';

const entries: PhotoEntry[] = [
  { exif: { camera: 'FUJIFILM X-T5' }, id: 'a.jpg', kind: 'image', name: 'a.jpg', parentId: '.' },
  { exif: { camera: 'Canon EOS R5' }, id: 'b.jpg', kind: 'image', name: 'b.jpg', parentId: '.' },
];

/** The URL's search parameters, to see what the toolbar changed. */
function Params() {
  const [params] = useSearchParams();
  return <output aria-label="Parameters">{params.toString()}</output>;
}

test('the filter button shows camera, lens and tag choices, and a choice narrows the view', async () => {
  const { screen } = await renderInLibrary(
    <>
      <Toolbar
        trail={[{ id: '.', name: 'Pictures' }]}
        mode="grid"
        entries={entries}
        refreshes={0}
        onRefresh={() => null}
      />
      <Params />
    </>,
    { width: 1400 },
  );
  await expect.element(screen.getByRole('combobox', { name: 'Camera' })).not.toBeInTheDocument();
  await screen.getByRole('button', { name: 'Filter by camera, lens or tag' }).click();
  const camera = screen.getByRole('combobox', { name: 'Camera' });
  await expect.element(camera).toBeVisible();
  await expect.element(screen.getByRole('combobox', { name: 'Lens' })).toBeVisible();
  await expect.element(screen.getByRole('combobox', { name: 'Tag' })).toBeVisible();
  expect(
    [...(camera.element() as HTMLSelectElement).options].map((option) => option.value),
  ).toEqual(['', 'Canon EOS R5', 'FUJIFILM X-T5']);
  await camera.selectOptions('Canon EOS R5');
  await expect
    .element(screen.getByRole('status', { name: 'Parameters' }))
    .toHaveTextContent('filter=1&camera=Canon+EOS+R5');
  await screen.getByRole('button', { name: 'Hide filters' }).click();
  await expect.element(screen.getByRole('status', { name: 'Parameters' })).toHaveTextContent('');
});
