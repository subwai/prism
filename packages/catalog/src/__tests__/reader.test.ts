import { details, entry, openDatabase, spec } from '#__tests__/fixtures';
import { catalogDatabase } from '#data/database';
import { registerLibrary } from '#data/libraries';
import { connectRatings } from '#ratings-file';
import { CatalogReader, type ReaderEvent } from '#reader';
import { type MadeOrder, ViewOrders } from '#view-orders';
import { viewSources } from '#views';
import { type CatalogWrite, writeCatalog } from '#writes';
import type { ViewSpec } from '@prism/shared';
import { expect, onTestFinished, test, vi } from 'vitest';

/**
 * A reader whose views' orders are made at once, or, once `hold` is called, only when `release`
 * is: as a view of a million entries keeps the thread that makes it busy.
 */
function openReader() {
  const connections = { index: openDatabase(), ratings: connectRatings(':memory:') };
  onTestFinished(() => connections.ratings.close());
  const library = registerLibrary(catalogDatabase(connections.index), '/library');
  const sources = viewSources(connections, '/library', library);
  const orders = new ViewOrders(sources);
  const made: ViewSpec[] = [];
  const counted: ViewSpec[] = [];
  const held: (() => void)[] = [];
  const events: ReaderEvent[] = [];
  let holding = false;
  let taking = 0;
  const reader = new CatalogReader(
    connections,
    '/library',
    library,
    (event) => events.push(event),
    {
      make(asked, generation) {
        made.push(asked);
        if (taking > 0) {
          vi.advanceTimersByTime(taking);
        }
        const order = orders.make(asked, generation);
        return holding
          ? new Promise<MadeOrder>((resolve) => {
              held.push(() => resolve(order));
            })
          : Promise.resolve(order);
      },
      unread(asked) {
        counted.push(asked);
        return Promise.resolve(orders.unread(asked));
      },
    },
  );
  onTestFinished(() => reader.close());
  return {
    /** The views whose photos still to read were counted on the views' thread, by folder. */
    counted: () => counted.map(({ directoryId }) => directoryId),
    /** The views told of unasked, by how many entries each version holds. */
    counts: () => events.flatMap((event) => ('view' in event ? [event.view.count] : [])),
    hold() {
      holding = true;
    },
    /** The views whose orders were asked for, by folder, in turn. */
    made: () => made.map(({ directoryId }) => directoryId),
    reader,
    /** Lets the orders being made go to the reader, and makes the rest at once. */
    async release() {
      holding = false;
      for (const resolve of held.splice(0)) {
        resolve();
      }
      await vi.waitFor(() => expect(held).toEqual([]));
    },
    /** Makes views' orders take `ms` from now on, by fake timers' clock. */
    took(ms: number) {
      taking = ms;
    },
    /** The views told of unasked, by how many photos each version holds still to read. */
    unread: () => events.flatMap((event) => ('view' in event ? [event.view.unread] : [])),
    /** Writes to the catalog, and tells the reader, as the writer does. */
    write(...writes: CatalogWrite[]) {
      reader.changed(writeCatalog(sources.db, library, writes).onlyDetails);
    },
  };
}

function ids(rows: { id: string }[] | null) {
  return rows?.map(({ id }) => id) ?? null;
}

test('the window is answered while a view is made again, from the version it reads', async () => {
  const { hold, reader, release, write } = openReader();
  write({ listed: [entry('a'), entry('b.jpg')] });
  const first = await reader.openView('view', spec());

  hold();
  write({ listed: [entry('c.jpg')] });
  const refreshing = reader.refreshView('view');
  // Nothing the window reads waits for the view being made.
  expect(ids(reader.viewRows('view', first.version, 0, 10))).toEqual(['a', 'b.jpg']);
  expect(reader.viewIndexOf('view', first.version, 'c.jpg')).toBe(-1);
  expect(ids(reader.entriesIn('.'))).toEqual(['a', 'b.jpg', 'c.jpg']);
  const { folders } = reader.folderSkeleton(['.']);
  expect(folders.flatMap(([, subfolders]) => subfolders.map(([id]) => id))).toEqual(['a']);

  await release();
  const second = await refreshing;
  expect(second).toMatchObject({ count: 3 });
  expect(ids(reader.viewRows('view', second?.version ?? 0, 0, 10))).toEqual([
    'a',
    'b.jpg',
    'c.jpg',
  ]);
});

test('a version answers from its own order until two newer ones are made', async () => {
  const { reader, write } = openReader();
  write({ listed: [entry('b.jpg')] });
  const first = await reader.openView('view', spec());
  write({ listed: [entry('a.jpg')] });
  const second = await reader.refreshView('view');

  expect(ids(reader.viewRows('view', first.version, 0, 10))).toEqual(['b.jpg']);
  expect(reader.viewIndexOf('view', first.version, 'b.jpg')).toBe(0);
  expect(reader.viewIndexOf('view', second?.version ?? 0, 'b.jpg')).toBe(1);

  write({ listed: [entry('c.jpg')] });
  await reader.refreshView('view');
  // That version has gone, and says so, rather than answering from another's order.
  expect(reader.viewRows('view', first.version, 0, 10)).toBeNull();
  expect(reader.viewIndexOf('view', first.version, 'b.jpg')).toBeNull();
  expect(ids(reader.viewRows('view', second?.version ?? 0, 0, 10))).toEqual(['a.jpg', 'b.jpg']);
});

test('changes while a view is made lead to one more make of it, which every caller hears', async () => {
  const { counts, hold, made, reader, release, write } = openReader();
  await reader.openView('view', spec());

  hold();
  write({ listed: [entry('a.jpg')] });
  const making = reader.refreshView('view');
  const asked: Promise<unknown>[] = [];
  for (const id of ['b.jpg', 'c.jpg', 'd.jpg']) {
    write({ listed: [entry(id)] });
    asked.push(reader.refreshView('view'));
  }
  expect(made()).toEqual(['.', '.']);

  await release();
  expect(await making).toMatchObject({ count: 1 });
  const versions = await Promise.all(asked);
  expect(new Set(versions).size).toBe(1);
  expect(versions[0]).toMatchObject({ count: 4 });
  expect(made()).toEqual(['.', '.', '.']);
  expect(counts()).toEqual([0, 1, 4]);
});

test('a view just opened is made before views waiting to be made again', async () => {
  const { hold, made, reader, release, write } = openReader();
  write({ listed: [entry('a'), entry('b'), entry('c')] });
  await reader.openView('a', spec({ directoryId: 'a' }));
  await reader.openView('b', spec({ directoryId: 'b' }));

  hold();
  write({ listed: [entry('a/1.jpg'), entry('b/1.jpg')] });
  const refreshed = [reader.refreshView('a'), reader.refreshView('b')];
  const opening = reader.openView('c', spec({ directoryId: 'c' }));
  await release();
  await Promise.all([...refreshed, opening]);
  expect(made()).toEqual(['a', 'b', 'a', 'c', 'b']);
});

test('closing a view, or the reader, drops what was to be made of it', async () => {
  const { counts, hold, made, reader, release, write } = openReader();
  write({ listed: [entry('a'), entry('b')] });
  await reader.openView('a', spec({ directoryId: 'a' }));
  await reader.openView('b', spec({ directoryId: 'b' }));

  hold();
  write({ listed: [entry('a/1.jpg'), entry('b/1.jpg')] });
  const making = reader.refreshView('a');
  const waiting = reader.refreshView('b');
  reader.closeView('a');
  reader.close();
  await release();
  expect(await making).toBeNull();
  expect(await waiting).toBeNull();
  expect(made()).toEqual(['a', 'b', 'a']);
  expect(counts()).toEqual([0, 0]);
});

test("photos' details coming in count a view by name again on the views' thread, and keep its order", async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const { counted, made, reader, unread, write } = openReader();
  write({ listed: [entry('a.jpg'), entry('b.jpg')] });
  const first = await reader.openView('view', spec());

  write({ details: [details('a.jpg', { camera: 'Canon EOS R5' })] });
  await vi.advanceTimersByTimeAsync(500);
  expect(made()).toEqual(['.']);
  // Counted where orders are made, so the window's reads never wait for it.
  expect(counted()).toEqual(['.']);
  expect(unread()).toEqual([2, 1]);
  // Its new version shows the photo's details, at the same places.
  const second = await reader.refreshView('view');
  expect(made()).toEqual(['.']);
  expect(second?.version).toBeGreaterThan(first.version);
  expect(reader.viewRows('view', second?.version ?? 0, 0, 10)?.[0]?.exif).toMatchObject({
    camera: 'Canon EOS R5',
  });
});

test("photos' details coming in make a view by date taken again, the later the longer it took", async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const { made, reader, took, write } = openReader();
  write({ listed: [entry('a.jpg'), entry('b.jpg')] });
  took(200);
  await reader.openView('view', spec({ sort: 'taken' }));

  // Made in 200 ms, it waits eight times as long for details, where a change of rows waits 500.
  write({ details: [details('a.jpg', { takenMs: 5000 })] });
  await vi.advanceTimersByTimeAsync(1500);
  expect(made()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(100);
  expect(made()).toHaveLength(2);
});
