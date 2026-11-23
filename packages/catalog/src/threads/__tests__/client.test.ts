import { details, entry, spec } from '#__tests__/fixtures';
import { catalogDatabase } from '#database/catalog-database';
import { openIndexToRead, openIndexToWrite } from '#database/photo-index/open';
import { registerLibrary } from '#repositories/libraries';
import { storeTreeListing } from '#services/tree/tree-listing';
import type { ViewVersion } from '#services/views/catalog-views';
import {
  catalogFiles,
  folders,
  heldCalls,
  ids,
  openCatalog,
} from '#threads/__tests__/client-fixtures';
import { inProcessHost } from '#threads/channels';
import { Catalog } from '#threads/client';
import { expect, onTestFinished, test, vi } from 'vitest';

test('the index is in WAL mode, which the reader reads beside the writer without writing', () => {
  const { index } = catalogFiles();
  const reader = openIndexToRead(index);
  onTestFinished(() => reader.close());
  expect(reader.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  expect(() => reader.exec('DELETE FROM items')).toThrow(/readonly/u);
});

test('the window reads while the writer is at a write, then sees it once it is committed', async () => {
  const { connect, release } = heldCalls('write');
  const catalog = openCatalog(catalogFiles(), connect);
  const number = catalog.write({ entries: [entry('a.jpg')], kind: 'list' });
  const committed = catalog.committed(number);
  let done = false;
  committed.then(() => {
    done = true;
  });

  // The write waits for the writer, and the read for nothing.
  expect(await ids(catalog)).toEqual([]);
  expect(done).toBe(false);

  release();
  await committed;
  expect(await ids(catalog)).toEqual(['a.jpg']);
});

test('the window reads while the writer counts the photos whose details are read, which is unknown until then', async () => {
  const { connect, release } = heldCalls('countDetails');
  const catalog = openCatalog(catalogFiles(), connect);
  expect(await ids(catalog)).toEqual([]);
  expect(catalog.activity().details).toBeNull();
  release();
  await vi.waitFor(() =>
    expect(catalog.activity().details).toEqual({ photos: 0, read: 0, unreadable: 0 }),
  );
});

test('the window reads while another connection holds a write transaction open', async () => {
  const files = catalogFiles();
  const catalog = openCatalog(files);
  catalog.write({ entries: [entry('a.jpg')], kind: 'list' });
  await catalog.committed();

  // Another open library's photo worker, say, writing the same index for a long time.
  const other = openIndexToWrite(files.index);
  onTestFinished(() => other.close());
  other.exec("BEGIN IMMEDIATE; DELETE FROM items WHERE name = 'a.jpg';");
  const started = performance.now();
  expect(await ids(catalog)).toEqual(['a.jpg']);
  // Well inside the five seconds a connection waits for another's write.
  expect(performance.now() - started).toBeLessThan(1000);
  other.exec('ROLLBACK');
});

test('the writer builds the tree listing while the window reads, and the reader reads a stored one', async () => {
  const files = catalogFiles();
  const { connect, release } = heldCalls('write');
  const catalog = openCatalog(files, connect);
  catalog.write({ entries: [entry('Trips'), entry('a.jpg')], kind: 'list' });
  const listed = catalog.committed();
  release();
  await listed;

  // Making it takes seconds from a cold disk; the window's reads go on meanwhile.
  catalog.write({ entries: [entry('Album')], kind: 'list' });
  let made: string[] | null = null;
  const making = catalog.listWholeTree().then((listing) => {
    made = folders(listing);
  });
  expect(await ids(catalog)).toEqual(['Trips', 'a.jpg']);
  expect(made).toBeNull();
  release();
  await making;
  expect(made).toEqual(['Album', 'Trips']);

  // One kept ready-made is read at once, however busy the writer.
  const writer = openIndexToWrite(files.index);
  onTestFinished(() => writer.close());
  const db = catalogDatabase(writer);
  storeTreeListing(db, registerLibrary(db, '/library'));
  catalog.write({ entries: [entry('b.jpg')], kind: 'list' });
  const committed = catalog.committed();
  expect(folders(await catalog.listWholeTree())).toEqual(['Album', 'Trips']);
  release();
  await committed;
});

test('views advance to new versions as the writer commits, with pages of what it wrote', async () => {
  const catalog = openCatalog();
  const told: ViewVersion[] = [];
  catalog.onEvent(({ view }) => told.push(view));
  catalog.write({ entries: [entry('b.jpg')], kind: 'list' });
  await catalog.committed();
  const first = await catalog.call('openView', 'view', spec());
  expect(first).toMatchObject({ count: 1 });

  catalog.write({ entries: [entry('a.jpg'), entry('c.jpg')], kind: 'list' });
  await catalog.committed();
  const second = await catalog.call('refreshView', 'view');
  expect(second?.version).toBeGreaterThan(first.version);
  expect(second?.count).toBe(3);
  const page = await catalog.call('viewRows', 'view', second?.version ?? 0, 1, 2);
  expect(page?.map((row) => row.id)).toEqual(['b.jpg', 'c.jpg']);
  // The version before still answers.
  const before = await catalog.call('viewRows', 'view', first.version, 0, 10);
  expect(before?.map((row) => row.id)).toEqual(['b.jpg']);

  // A write the window made no read after still reaches it, as a new version told unasked.
  catalog.write({ ids: ['b.jpg'], kind: 'remove' });
  await vi.waitFor(() => expect(told.at(-1)?.count).toBe(2), { interval: 50, timeout: 3000 });
  expect(told.at(-1)?.version).toBeGreaterThan(second?.version ?? 0);
});

test('an edit is seen by the next read, with no wait for queued writes', async () => {
  const catalog = openCatalog();
  catalog.write({ entries: [entry('trips'), entry('clip.mov', { kind: 'video' })], kind: 'list' });
  await catalog.committed();
  const { version } = await catalog.call('openView', 'view', spec());

  // The writer answers an edit once it is committed, and tells the reader first.
  await catalog.call('rate', 'clip.mov', 3);
  const rows = await catalog.call('entriesIn', '.');
  expect(rows.find((row) => row.id === 'clip.mov')?.rating).toBe(3);
  const refreshed = await catalog.call('refreshView', 'view');
  expect(refreshed?.version).toBeGreaterThan(version);
  const filtered = await catalog.call(
    'openView',
    'rated',
    spec({ filter: { ...spec().filter, rating: ['min3'] } }),
  );
  expect(filtered.count).toBe(1);

  await catalog.call('moveRatings', 'clip.mov', 'renamed.mov');
  expect((await catalog.call('entriesIn', '.')).find((row) => row.id === 'clip.mov')?.rating).toBe(
    undefined,
  );
});

test('the details queue reads first the photos the window last asked for', async () => {
  const catalog = openCatalog();
  const photos = Array.from({ length: 6 }, (_photo, index) => entry(`${index}.jpg`));
  catalog.write({ entries: photos, kind: 'list' });
  await catalog.committed();
  const { version } = await catalog.call('openView', 'view', spec());
  await catalog.call('viewRows', 'view', version, 4, 2);
  expect((await catalog.call('photosToRead', 2)).map(({ id }) => id)).toEqual(['4.jpg', '5.jpg']);

  catalog.write({ details: [details('4.jpg', {}), details('5.jpg', {})], kind: 'storeDetails' });
  expect((await catalog.call('photosToRead', 2)).map(({ id }) => id)).toEqual(['0.jpg', '1.jpg']);
});

test('a catalog kept in memory shares one connection between its reader and writer', async () => {
  const catalog = openCatalog({ index: ':memory:', ratings: ':memory:' });
  catalog.write({ entries: [entry('a')], kind: 'list' });
  await catalog.committed();
  expect(await ids(catalog)).toEqual(['a']);
  const { version } = await catalog.call('openView', 'view', spec());
  await catalog.call('rate', 'a', 2);
  expect((await catalog.call('refreshView', 'view'))?.version).toBeGreaterThan(version);
});

test('a write that changes no row leaves views as they are, and one that does makes them again', async () => {
  const files = catalogFiles();
  const catalog = openCatalog(files);
  const told: ViewVersion[] = [];
  catalog.onEvent(({ view }) => told.push(view));
  catalog.write({ entries: [entry('trips'), entry('a.jpg'), entry('trips/b.jpg')], kind: 'list' });
  catalog.write({ folderId: '.', kind: 'markIndexed' });
  catalog.write({ folderId: 'trips', kind: 'markIndexed' });
  await catalog.committed();
  const folder = await catalog.call('openView', 'folder', spec());
  const library = await catalog.call('openView', 'library', spec({ recursive: true }));
  told.splice(0);

  // A read of the library again that finds it as it was, and a file listed again as it is.
  catalog.write({ entries: [entry('a.jpg'), entry('trips/b.jpg')], kind: 'list' });
  catalog.write({ folderId: '.', kind: 'markIndexed' });
  catalog.write({ folderId: 'trips', kind: 'markIndexed' });
  catalog.write({ ids: ['gone.jpg'], kind: 'remove' });
  await catalog.committed();
  expect(await catalog.call('refreshView', 'folder')).toEqual(folder);
  expect(await catalog.call('refreshView', 'library')).toEqual(library);

  // Another library in the same index changes nothing of this one's views.
  const other = new Catalog(files, '/other', inProcessHost);
  onTestFinished(() => other.close());
  other.write({ entries: [entry('c.jpg')], kind: 'list' });
  await other.committed();
  expect(await catalog.call('refreshView', 'library')).toEqual(library);
  expect(told).toEqual([]);

  catalog.write({ entries: [entry('trips/c.jpg')], kind: 'list' });
  await catalog.committed();
  const changed = await catalog.call('refreshView', 'library');
  expect(changed?.version).toBeGreaterThan(library.version);
  expect(changed?.count).toBe(library.count + 1);
});

test('the catalog says what it is busy with: entries to write, views it makes again, and photos read', async () => {
  const { connect, release } = heldCalls('write');
  const catalog = openCatalog(catalogFiles(), connect);
  const views: boolean[] = [];
  catalog.onActivity(() => views.push(catalog.activity().rebuildingViews));
  catalog.write({ entries: [entry('a.jpg'), entry('b.jpg')], kind: 'list' });
  expect(catalog.activity().unsavedEntries).toBe(2);
  const listed = catalog.committed();
  // Sent to the writer, and still to be written.
  expect(catalog.activity().unsavedEntries).toBe(2);
  release();
  await listed;
  expect(catalog.activity().unsavedEntries).toBe(0);

  await catalog.call('openView', 'view', spec());
  catalog.write({ entries: [entry('c.jpg')], kind: 'list' });
  const written = catalog.committed();
  release();
  await written;
  await catalog.call('refreshView', 'view');
  await vi.waitFor(() => expect(views).toContain(true));
  await vi.waitFor(() =>
    expect(catalog.activity()).toEqual({
      details: { photos: 3, read: 0, unreadable: 0 },
      forgettingDetails: null,
      rebuildingTree: false,
      rebuildingViews: false,
      unsavedEntries: 0,
    }),
  );
});
