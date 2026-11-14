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

/** The root's photos in a filmstrip, whose thumbnails grow as the button is pressed. */
function RootFilmstrip() {
  const library = useLibrary();
  const view = use(library.view(folderSpec('.')));
  const [size, setSize] = useState(76);
  return (
    <div className="flex h-60 w-200 flex-col">
      <button type="button" onClick={() => setSize(150)}>
        Grow
      </button>
      <Collection
        view={view}
        selectedId={null}
        onSelect={() => null}
        size={size}
        mode="filmstrip"
      />
    </div>
  );
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

test('filmstrip cards take the size they are given, and change with it', async () => {
  const { screen } = await renderInLibrary(
    <Suspense>
      <RootFilmstrip />
    </Suspense>,
    { api: fakeAPI([], photos) },
  );
  const first = screen.getByRole('option', { name: 'IMG_00000.jpg' });
  await expect.poll(() => first.element().getBoundingClientRect().width).toBe(76);
  await screen.getByRole('button', { name: 'Grow' }).click();
  await expect.poll(() => first.element().getBoundingClientRect().width).toBe(150);
  // The next card moves along to make room.
  await expect
    .poll(
      () =>
        screen.getByRole('option', { name: 'IMG_00001.jpg' }).element().getBoundingClientRect()
          .left - first.element().getBoundingClientRect().left,
    )
    .toBe(150 + 12);
});

/** The name of the card at the middle of the filmstrip, if one is there and read. */
function middleCard(strip: Element) {
  const box = strip.getBoundingClientRect();
  return document
    .elementFromPoint(box.left + box.width / 2, box.top + 30)
    ?.closest('[role="option"]')
    ?.getAttribute('aria-label');
}

test('a growing filmstrip keeps the card in its middle there', async () => {
  const { screen } = await renderInLibrary(
    <Suspense>
      <RootFilmstrip />
    </Suspense>,
    { api: fakeAPI([], photos) },
  );
  const strip = screen.getByRole('listbox', { name: 'Photo filmstrip' }).element();
  await expect.element(screen.getByRole('option', { name: 'IMG_00000.jpg' })).toBeVisible();
  strip.scrollLeft = 10_000;
  await expect.poll(() => middleCard(strip)).toBe('IMG_00118.jpg');
  await screen.getByRole('button', { name: 'Grow' }).click();
  await expect.poll(() => strip.scrollLeft).toBeGreaterThan(10_000);
  await expect.poll(() => middleCard(strip)).toBe('IMG_00118.jpg');
});

test('a growing filmstrip scrolled to its end stays there', async () => {
  const { screen } = await renderInLibrary(
    <Suspense>
      <RootFilmstrip />
    </Suspense>,
    { api: fakeAPI([], photos) },
  );
  const strip = screen.getByRole('listbox', { name: 'Photo filmstrip' }).element();
  await expect.element(screen.getByRole('option', { name: 'IMG_00000.jpg' })).toBeVisible();
  strip.scrollLeft = strip.scrollWidth;
  await expect.element(screen.getByRole('option', { name: 'IMG_19999.jpg' })).toBeVisible();
  await screen.getByRole('button', { name: 'Grow' }).click();
  await expect.poll(() => strip.scrollLeft).toBe(strip.scrollWidth - strip.clientWidth);
  await expect.element(screen.getByRole('option', { name: 'IMG_19999.jpg' })).toBeVisible();
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

test('a new version of as many entries shows the rows it holds', async () => {
  const { api, screen } = await renderGrid();
  await expect.element(screen.getByRole('option', { name: 'IMG_00000.jpg' })).toBeVisible();
  const [state] = await Promise.all(api.openView.mock.results.map(({ value }) => value));
  // As a photo renamed on disk, which leaves the count as it was.
  const renamed: PhotoEntry = { id: 'AAA.jpg', kind: 'image', name: 'AAA.jpg', parentId: '.' };
  api.viewRows.mockImplementation((_viewId, _version, start, count) =>
    Promise.resolve([renamed, ...photos.slice(1)].slice(start, start + count)),
  );
  if (state) {
    tellView(api, { ...state, version: 2 });
  }
  await expect.element(screen.getByRole('option', { name: 'AAA.jpg' })).toBeVisible();
});

test('the selection follows its photo as a rename of another moves it', async () => {
  const { api, screen } = await renderGrid();
  await screen.getByRole('option', { name: 'IMG_00001.jpg' }).click();
  const [state] = await Promise.all(api.openView.mock.results.map(({ value }) => value));
  // The last photo renamed to sort first: as many entries, the selection one further on.
  const renamed: PhotoEntry = { id: 'AAA.jpg', kind: 'image', name: 'AAA.jpg', parentId: '.' };
  const rows = [renamed, ...photos.slice(0, -1)];
  api.viewRows.mockImplementation((_viewId, _version, start, count) =>
    Promise.resolve(rows.slice(start, start + count)),
  );
  api.viewIndexOf.mockImplementation((_viewId, _version, id) =>
    Promise.resolve(rows.findIndex((entry) => entry.id === id)),
  );
  if (state) {
    tellView(api, { ...state, version: 2 });
  }
  await expect
    .element(screen.getByRole('option', { name: 'IMG_00001.jpg' }))
    .toHaveAttribute('aria-selected', 'true');
  await expect
    .element(screen.getByRole('option', { name: 'IMG_00001.jpg' }))
    .toHaveAttribute('aria-posinset', '3');
});

/** The rows on show the worker last heard of, by view. */
function rowsTold(api: ReturnType<typeof fakeAPI>) {
  return api.attend.mock.calls.at(-1)?.[0].views ?? [];
}

test('the worker hears which rows are on show, without those rendered past the edges', async () => {
  const { api, screen } = await renderGrid();
  await expect.element(screen.getByRole('option', { name: 'IMG_00000.jpg' })).toBeVisible();
  await expect.poll(() => rowsTold(api)).toHaveLength(1);
  const [shown] = rowsTold(api);
  const list = screen.getByRole('listbox', { name: 'Folder contents' }).element();
  const edges = list.getBoundingClientRect();
  const options = screen.getByRole('option').elements();
  const onScreen = options.filter((option) => {
    const { bottom, top } = option.getBoundingClientRect();
    return bottom > edges.top && top < edges.bottom;
  });
  expect(shown?.start).toBe(0);
  // Whole rows, fewer than those rendered.
  expect(shown?.end).toBeGreaterThanOrEqual(onScreen.length);
  expect(shown?.end).toBeLessThan(options.length);

  list.scrollTop = 5000;
  await expect.poll(() => rowsTold(api)[0]?.start).toBeGreaterThan(0);
});

test('the worker hears a view is no longer on show once its list goes', async () => {
  const { api, screen } = await renderGrid();
  await expect.poll(() => rowsTold(api)).toHaveLength(1);
  await screen.unmount();
  await expect.poll(() => rowsTold(api)).toEqual([]);
});
