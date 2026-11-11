import { renderInLibrary } from '#components/__tests__/render';
import { FilmstripView } from '#components/gallery/filmstrip-view';
import { fakeAPI } from '#data/__tests__/fixtures';
import { folderSpec } from '#data/urls';
import { useLibrary } from '#hooks/use-library';
import type { PhotoEntry } from '@prism/shared';
import { Suspense, use, useState } from 'react';
import { expect, test } from 'vitest';

const entries: PhotoEntry[] = ['landscape.jpg', 'portrait.jpg', 'small.jpg'].map((name) => ({
  id: name,
  kind: 'image',
  name,
  parentId: '.',
}));

/** The root's photos in a filmstrip, searched for what the button says once it is pressed. */
function RootFilmstrip() {
  const library = useLibrary();
  const [search, setSearch] = useState('');
  const view = use(library.view({ ...folderSpec('.'), search }));
  return (
    <>
      <button type="button" onClick={() => setSearch('portrait')}>
        Search
      </button>
      <div className="flex min-h-0 flex-1">
        <FilmstripView data={{ trail: [{ id: '.', name: 'Pictures' }], view }} />
      </div>
    </>
  );
}

test('the filmstrip shows the first photo while a search leaves the chosen one out', async () => {
  const { screen } = await renderInLibrary(
    <Suspense>
      <RootFilmstrip />
    </Suspense>,
    { api: fakeAPI([], entries) },
  );
  const strip = screen.getByRole('listbox', { name: 'Photo filmstrip' });
  await strip.getByRole('option', { name: 'small.jpg' }).click();
  await expect
    .element(strip.getByRole('option', { selected: true }))
    .toHaveAccessibleName('small.jpg');
  await screen.getByRole('button', { name: 'Search' }).click();
  await expect
    .element(strip.getByRole('option', { selected: true }))
    .toHaveAccessibleName('portrait.jpg');
});
