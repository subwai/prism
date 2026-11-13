import { createPendingEdits, type EntryEdits, shownEntry } from '#data/pending-edits';
import type { PhotoEntry } from '@prism/shared';
import { expect, test, vi } from 'vitest';

type Store = ReturnType<typeof createPendingEdits>;

const beach: PhotoEntry = { id: 'beach.jpg', kind: 'image', name: 'beach.jpg', parentId: '.' };

/** `entry` as the store shows it now. */
function shown(store: Store, entry = beach) {
  return shownEntry(store.getSnapshot(), entry);
}

/**
 * Starts editing `id`'s `field` in `store`, with a write that waits for the test: `answer`
 * settles it with what the write answered and ends it, `fail` ends it with an error.
 */
function begin<Name extends keyof EntryEdits>(
  store: Store,
  id: string,
  field: Name,
  value: NonNullable<EntryEdits[Name]>['value'],
) {
  const written = Promise.withResolvers<null>();
  let edit = 0;
  const running = store.run(id, field, value, (started) => {
    edit = started;
    return written.promise;
  });
  return {
    async answer(answered = value, settled: (edit: number) => void = () => null) {
      store.settle(id, field, edit, answered);
      settled(edit);
      written.resolve(null);
      await running;
    },
    async fail() {
      written.reject(new Error('Not written.'));
      await expect(running).rejects.toThrow('Not written.');
    },
  };
}

test('an edit shows at once, then as answered, until it ends', async () => {
  const store = createPendingEdits();
  const listener = vi.fn();
  store.subscribe(listener);
  const rating = begin(store, beach.id, 'rating', 3);
  expect(listener).toHaveBeenCalledOnce();
  expect(shown(store)).toMatchObject({ rating: 3 });
  // The worker may answer with what the file holds, rather than what was asked.
  await rating.answer(4, () => {
    expect(shown(store)).toMatchObject({ rating: 4 });
  });
  expect(shown(store)).toBe(beach);
});

test('an edited entry stays the same object while nothing changes', () => {
  const store = createPendingEdits();
  begin(store, beach.id, 'rating', 3);
  expect(shown(store)).toBe(shown(store));
  expect(shown(store, { ...beach, id: 'other.jpg' })).toEqual({ ...beach, id: 'other.jpg' });
});

test('a failed edit ends, and the entry shows as it was', async () => {
  const store = createPendingEdits();
  const rated = { ...beach, rating: 2 as const };
  const rating = begin(store, beach.id, 'rating', null);
  expect(shown(store, rated).rating).toBeUndefined();
  await rating.fail();
  expect(shown(store, rated)).toBe(rated);
});

test('quick edits end on the last, whatever order their answers come in', async () => {
  const store = createPendingEdits();
  const first = begin(store, beach.id, 'rating', 1);
  const second = begin(store, beach.id, 'rating', 2);
  const third = begin(store, beach.id, 'rating', 3);
  await first.answer();
  expect(shown(store)).toMatchObject({ rating: 3 });
  // An earlier edit failing leaves the last showing.
  await second.fail();
  expect(shown(store)).toMatchObject({ rating: 3 });
  await third.answer();
  expect(shown(store)).toBe(beach);
});

test('a later answer to an earlier edit changes nothing once the last has settled', async () => {
  const store = createPendingEdits();
  const first = begin(store, beach.id, 'rating', 1);
  const second = begin(store, beach.id, 'rating', 2);
  await second.answer(2, () => {
    expect(shown(store)).toMatchObject({ rating: 2 });
  });
  await first.answer();
  expect(shown(store)).toBe(beach);
});

test('a rating and a rename of the same entry show together', async () => {
  const store = createPendingEdits();
  const rating = begin(store, beach.id, 'rating', 5);
  begin(store, beach.id, 'name', 'shore.jpg');
  expect(shown(store)).toMatchObject({ id: beach.id, name: 'shore.jpg', rating: 5 });
  await rating.answer();
  expect(shown(store)).toEqual({ ...beach, name: 'shore.jpg' });
});

/** Renames `from` to `name` in `store`, with an entry of that name in the same folder. */
async function rename(store: Store, from: string, name: string) {
  const renamed = { ...beach, id: name, name };
  const renaming = begin(store, from, 'name', name);
  await renaming.answer(name, (edit) => store.renamed(from, edit, renamed));
  return renamed;
}

test('a rename shows the new name on rows of the old ID, and finds it under the new one', async () => {
  const store = createPendingEdits();
  const renaming = begin(store, beach.id, 'name', 'shore.jpg');
  // The row keeps its ID until the view is read again, so it stays where it is.
  expect(shown(store)).toEqual({ ...beach, name: 'shore.jpg' });
  const renamed = { ...beach, id: 'shore.jpg', name: 'shore.jpg' };
  await renaming.answer('shore.jpg', (edit) => store.renamed(beach.id, edit, renamed));
  expect(store.getSnapshot().edits.size).toBe(0);
  expect(shown(store)).toEqual({ ...beach, name: 'shore.jpg' });
  expect(store.follow(beach.id)).toBe('shore.jpg');
  // Rows read since name it by its new ID already.
  expect(shown(store, renamed)).toBe(renamed);
  // Edits made since go by the new ID, and show on rows of either.
  begin(store, 'shore.jpg', 'rating', 4);
  expect(shown(store)).toMatchObject({ id: beach.id, name: 'shore.jpg', rating: 4 });
  expect(shown(store, renamed)).toMatchObject({ id: 'shore.jpg', rating: 4 });
});

test('a rename renamed again shows its latest name on rows of the first ID', async () => {
  const store = createPendingEdits();
  await rename(store, beach.id, 'shore.jpg');
  await rename(store, 'shore.jpg', 'sand.jpg');
  expect(shown(store).name).toBe('sand.jpg');
  expect(store.follow(beach.id)).toBe('sand.jpg');
});

test('a rename answered after another edit of the name leaves that one showing', async () => {
  const store = createPendingEdits();
  const first = begin(store, beach.id, 'name', 'shore.jpg');
  const second = begin(store, beach.id, 'name', 'sand.jpg');
  await first.answer('shore.jpg', (edit) =>
    store.renamed(beach.id, edit, { ...beach, id: 'shore.jpg', name: 'shore.jpg' }),
  );
  expect(shown(store).name).toBe('sand.jpg');
  // The second asked for the old ID, which has gone, so it fails.
  await second.fail();
  expect(shown(store).name).toBe('shore.jpg');
});

test('a failed rename shows the old name again, and leads nowhere', async () => {
  const store = createPendingEdits();
  await begin(store, beach.id, 'name', 'taken.jpg').fail();
  expect(shown(store)).toBe(beach);
  expect(store.follow(beach.id)).toBe(beach.id);
});

test('an entry found at a renamed ID is itself again', async () => {
  const store = createPendingEdits();
  await rename(store, beach.id, 'shore.jpg');
  store.found(['other.jpg']);
  expect(shown(store).name).toBe('shore.jpg');
  // Something new took the old name, as a file copied in might.
  store.found([beach.id]);
  expect(shown(store)).toBe(beach);
  expect(store.follow(beach.id)).toBe(beach.id);
});
