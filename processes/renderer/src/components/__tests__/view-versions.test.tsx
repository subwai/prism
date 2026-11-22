import { renderInLibrary } from '#components/__tests__/render';
import { Collection } from '#components/collection';
import { fakeAPI, sendViewState } from '#data/__tests__/fixtures';
import { folderSpec } from '#data/urls';
import { useViewEntries, useViewEntry } from '#hooks/use-gallery-view';
import { useLibrary } from '#hooks/use-library';
import type { PhotoEntry, ViewState } from '@prism/shared';
import { Suspense, use } from 'react';
import { expect, test } from 'vitest';

// A view's new versions, as the worker makes one each time photos' details come in and the
// order changes, change only what moved.

const photos: PhotoEntry[] = Array.from({ length: 12 }, (_photo, index) => {
  const name = `photo-${String(index).padStart(2, '0')}.jpg`;
  return { id: name, kind: 'image', name, parentId: '.' };
});

/** The worker's API, whose view shows `photos` at version 1 and `next` from version 2 on. */
function versionedAPI(next: PhotoEntry[]) {
  const api = fakeAPI([], photos);
  api.viewRows.mockImplementation((_viewId, version, start, count) =>
    Promise.resolve((version < 2 ? photos : next).slice(start, start + count)),
  );
  return api;
}

/** Tells the library of the view's version 2, as the worker does. */
async function tellVersion2(api: ReturnType<typeof fakeAPI>) {
  const [state] = (await Promise.all(
    api.openView.mock.results.map(({ value }) => value),
  )) as ViewState[];
  if (state) {
    sendViewState(api, { ...state, version: 2 });
  }
}

function Root() {
  const library = useLibrary();
  const view = use(library.view(folderSpec('.')));
  return <Collection view={view} selectedId={null} onSelect={() => null} size={170} />;
}

test('cards that move to other rows in a new version stay the same, with nothing in their place meanwhile', async () => {
  // Each photo moves one place on, so the last of each row starts the next.
  const rotated = [...photos.slice(-1), ...photos.slice(0, -1)];
  const api = versionedAPI(rotated);
  const { screen } = await renderInLibrary(
    <Suspense>
      <Root />
    </Suspense>,
    { api },
  );
  const list = screen.getByRole('listbox').element();
  await expect.element(screen.getByRole('option', { name: 'photo-11.jpg' })).toBeVisible();
  const cards = new Map(
    [...list.querySelectorAll('[role="option"]')].map((card) => [card.ariaLabel, card]),
  );
  const removed: Node[] = [];
  const watch = new MutationObserver((records) => {
    removed.push(...records.flatMap((record) => [...record.removedNodes]));
  });
  watch.observe(list, { childList: true, subtree: true });

  await tellVersion2(api);
  await expect.poll(() => list.querySelector('[role="option"]')?.ariaLabel).toBe('photo-11.jpg');
  watch.disconnect();
  // Moved within one parent, not taken out and made again: a move counts as a removal too,
  // but leaves the card in the list. A placeholder in a card's place would take it out.
  for (const card of list.querySelectorAll('[role="option"]')) {
    expect(card).toBe(cards.get(card.ariaLabel));
  }
  const gone = removed.filter(
    (node) => node instanceof Element && node.role === 'option' && !node.isConnected,
  );
  expect(gone).toEqual([]);
});

/** Every entry `useViewEntry` gave, render by render. */
const given: (string | undefined)[] = [];

/** The entry `entryId`, read as the filmstrip reads its selection beside the view's first. */
function Chosen({ entryId }: { entryId: string }) {
  const library = useLibrary();
  const view = use(library.view(folderSpec('.')));
  const { entry } = useViewEntry(view, entryId);
  const first = useViewEntries(view, 0, 1)(0);
  given.push(entry?.id);
  return (
    <>
      <output aria-label="Chosen">{entry?.name}</output>
      <output aria-label="First">{first?.name}</output>
    </>
  );
}

test('an entry stays itself while a new version moves it and its new place is not known yet', async () => {
  // The order turns round: photo-02 moves to the tenth place, and photo-09 takes its own.
  const reversed = photos.toReversed();
  const api = versionedAPI(reversed);
  // The new place takes a while to find, as on a large view.
  const place = Promise.withResolvers<number>();
  api.viewIndexOf.mockImplementation((_viewId, version, entryId) =>
    version < 2
      ? Promise.resolve(photos.findIndex((photo) => photo.id === entryId))
      : place.promise,
  );
  given.length = 0;
  const { screen } = await renderInLibrary(
    <Suspense>
      <Chosen entryId="photo-02.jpg" />
    </Suspense>,
    { api },
  );
  const chosen = screen.getByRole('status', { name: 'Chosen' });
  await expect.element(chosen).toHaveTextContent('photo-02.jpg');

  await tellVersion2(api);
  // The new version's rows are on show, its first among them, before photo-02's place is known.
  await expect
    .element(screen.getByRole('status', { name: 'First' }))
    .toHaveTextContent('photo-11.jpg');
  expect(chosen.element()).toHaveTextContent('photo-02.jpg');
  place.resolve(reversed.findIndex((photo) => photo.id === 'photo-02.jpg'));
  await expect.element(chosen).toHaveTextContent('photo-02.jpg');
  expect(new Set(given.filter(Boolean))).toEqual(new Set(['photo-02.jpg']));
});
