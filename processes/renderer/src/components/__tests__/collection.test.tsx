import { renderInLibrary } from '#components/__tests__/render';
import { Collection } from '#components/collection';
import { fakeAPI, tellView } from '#data/__tests__/fixtures';
import { VIEW_PAGE } from '#data/gallery-view';
import { folderSpec } from '#data/urls';
import { useLibrary } from '#hooks/use-library';
import type { PhotoEntry } from '@prism/shared';
import { Suspense, use, useState } from 'react';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

const photos: PhotoEntry[] = Array.from({ length: 20_000 }, (_photo, index) => {
  const name = `IMG_${String(index).padStart(5, '0')}.jpg`;
  return { id: name, kind: 'image', name, parentId: '.' };
});

/** The root's photos in a grid, with the selection kept as the grid view keeps it. */
function RootGrid() {
  const library = useLibrary();
  const view = use(library.view(folderSpec('.')));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <Collection
      view={view}
      selectedId={selectedId}
      onSelect={(entry) => setSelectedId(entry.id)}
      size={170}
    />
  );
}

async function renderGrid(api = fakeAPI([], photos)) {
  const rendered = await renderInLibrary(
    <Suspense>
      <RootGrid />
    </Suspense>,
    { api },
  );
  return { api, ...rendered };
}

/** The pages of the view the worker was asked for, by where they start. */
function pagesRead(api: ReturnType<typeof fakeAPI>) {
  return new Set(api.viewRows.mock.calls.map((call) => call[2] / VIEW_PAGE));
}

test('a large view reads only the rows on screen, which hold their place until read', async () => {
  const api = fakeAPI([], photos);
  const held = Promise.withResolvers<null>();
  const answer = api.viewRows.getMockImplementation();
  api.viewRows.mockImplementation(async (...args) => {
    await held.promise;
    return answer?.(...args) ?? null;
  });
  const { screen } = await renderGrid(api);
  const list = screen.getByRole('listbox', { name: 'Folder contents' });
  await expect.poll(() => list.element().querySelectorAll('.shimmer').length).toBeGreaterThan(0);
  held.resolve(null);
  await expect.element(screen.getByRole('option', { name: 'IMG_00000.jpg' })).toBeVisible();
  expect(list.element().querySelectorAll('.shimmer')).toHaveLength(0);
  expect(pagesRead(api)).toEqual(new Set([0]));
  // Each option says where it falls among all of them, though few are rendered.
  await expect
    .element(screen.getByRole('option', { name: 'IMG_00000.jpg' }))
    .toHaveAttribute('aria-setsize', '20000');
});

test('End selects the last entry, reading only its page', async () => {
  const { api, screen } = await renderGrid();
  await screen.getByRole('option', { name: 'IMG_00000.jpg' }).click();
  await userEvent.keyboard('{End}');
  await expect
    .element(screen.getByRole('option', { name: 'IMG_19999.jpg' }))
    .toHaveAttribute('aria-selected', 'true');
  expect(pagesRead(api).size).toBeLessThanOrEqual(3);
});

test('the selection stays as a new version moves it', async () => {
  const { api, screen } = await renderGrid();
  await screen.getByRole('option', { name: 'IMG_00001.jpg' }).click();
  const [state] = await Promise.all(api.openView.mock.results.map(({ value }) => value));
  const added: PhotoEntry = { id: 'AAA.jpg', kind: 'image', name: 'AAA.jpg', parentId: '.' };
  api.viewRows.mockImplementation((_viewId, _version, start, count) =>
    Promise.resolve([added, ...photos].slice(start, start + count)),
  );
  api.viewIndexOf.mockImplementation((_viewId, _version, id) =>
    Promise.resolve([added, ...photos].findIndex((entry) => entry.id === id)),
  );
  if (state) {
    tellView(api, { ...state, count: photos.length + 1, version: 2 });
  }
  await expect.element(screen.getByRole('option', { name: 'AAA.jpg' })).toBeVisible();
  await expect
    .element(screen.getByRole('option', { name: 'IMG_00001.jpg' }))
    .toHaveAttribute('aria-selected', 'true');
  await expect
    .element(screen.getByRole('option', { name: 'IMG_00001.jpg' }))
    .toHaveAttribute('aria-posinset', '3');
});
