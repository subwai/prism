import { renderInLibrary } from '#components/__tests__/render';
import { Collection } from '#components/collection';
import { fakeAPI, photo } from '#data/__tests__/fixtures';
import { folderSpec } from '#data/urls';
import { useLibrary } from '#hooks/use-library';
import type { PhotoEntry, Rating } from '@prism/shared';
import { Suspense, use, useState } from 'react';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

/** Three photos, each a copy, so a test can change their rows as the catalog would. */
function threePhotos(): PhotoEntry[] {
  return ['IMG_00000.jpg', 'IMG_00001.jpg', 'IMG_00002.jpg'].map((name) => ({
    id: name,
    kind: 'image',
    name,
    parentId: '.',
  }));
}

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

function renderGrid(api: ReturnType<typeof fakeAPI>) {
  return renderInLibrary(
    <Suspense>
      <RootGrid />
    </Suspense>,
    { api },
  );
}

/** Writes a rating into `rows`, as the catalog does before the worker answers with it. */
function store(rows: PhotoEntry[], entryId: string, rating: Rating | null) {
  const entry = rows.find(({ id }) => id === entryId) ?? photo;
  delete entry.rating;
  if (rating !== null) {
    entry.rating = rating;
  }
  return { entry: { ...entry } };
}

/** A fake library of three photos, which rates each once `answer` lets it through. */
function rated(answer: () => Promise<unknown>) {
  const rows = threePhotos();
  const api = fakeAPI([], rows);
  api.rateEntry.mockImplementation(async (entryId, rating) => {
    await answer();
    return store(rows, entryId, rating);
  });
  return api;
}

test('a digit rates the selection, shown on its card at once, and the same digit unrates it', async () => {
  const written = Promise.withResolvers<null>();
  const api = rated(() => written.promise);
  const { screen } = await renderGrid(api);
  const card = screen.getByRole('option', { name: 'IMG_00001.jpg' });
  await card.click();
  await userEvent.keyboard('3');
  // The stars show while the rating is still being written.
  await expect.element(card.getByLabelText('3 stars')).toBeVisible();
  expect(api.rateEntry).toHaveBeenLastCalledWith('IMG_00001.jpg', 3);
  written.resolve(null);
  await expect.poll(() => api.rateEntry.mock.calls.length).toBe(1);
  await expect.element(card.getByLabelText('3 stars')).toBeVisible();

  await userEvent.keyboard('3');
  await expect.poll(() => api.rateEntry.mock.lastCall).toEqual(['IMG_00001.jpg', null]);
  await expect.element(card.getByLabelText('3 stars')).not.toBeInTheDocument();
});

test('a rating that fails shows on its card until it does, then the old one again', async () => {
  const rows = threePhotos();
  Object.assign(rows[0] ?? photo, { rating: 2 });
  const api = fakeAPI([], rows);
  const failed = Promise.withResolvers<null>();
  api.rateEntry.mockImplementation(async () => {
    await failed.promise;
    return { error: 'It is on a disk that can’t be changed.' };
  });
  const { screen } = await renderGrid(api);
  const card = screen.getByRole('option', { name: 'IMG_00000.jpg' });
  await expect.element(card.getByLabelText('2 stars')).toBeVisible();
  await card.click();
  await userEvent.keyboard('5');
  await expect.element(card.getByLabelText('5 stars')).toBeVisible();
  failed.resolve(null);
  await expect.element(card.getByLabelText('2 stars')).toBeVisible();
  expect(card.getByLabelText('5 stars').query()).toBeNull();
});

test('rating keys pressed in a row end on the last, whatever order the answers come in', async () => {
  const rows = threePhotos();
  const api = fakeAPI([], rows);
  const answers: (() => void)[] = [];
  api.rateEntry.mockImplementation(async (entryId, rating) => {
    // Written in turn, as the worker writes an entry's ratings, but answered as the test says.
    const answer = store(rows, entryId, rating);
    await new Promise<void>((resolve) => {
      answers.push(resolve);
    });
    return answer;
  });
  const { screen } = await renderGrid(api);
  const card = screen.getByRole('option', { name: 'IMG_00001.jpg' });
  await card.click();
  await userEvent.keyboard('245');
  await expect.element(card.getByLabelText('5 stars')).toBeVisible();
  await expect.poll(() => answers.length).toBe(3);
  answers[2]?.();
  answers[0]?.();
  await expect.element(card.getByLabelText('5 stars')).toBeVisible();
  answers[1]?.();
  await expect.poll(() => api.viewRows.mock.calls.length).toBeGreaterThan(1);
  await expect.element(card.getByLabelText('5 stars')).toBeVisible();
  expect(card.getByLabelText('4 stars').query()).toBeNull();
});
