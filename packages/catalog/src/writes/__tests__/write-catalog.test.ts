import { changedAt, details, entry, openCatalog, openDatabase, spec } from '#__tests__/fixtures';
import { nameKey, parentKey } from '#data/codes';
import { catalogDatabase } from '#data/database';
import { countUnread, forgetAllDetails } from '#data/details';
import { photosTagged } from '#data/filters';
import { folderReadMs, folderStamp, isIndexed } from '#data/indexed-folders';
import { entriesInOrder, itemOf, knownItemsAt } from '#data/items';
import { fullReads } from '#data/libraries';
import {
  detailsQueue,
  nextUnread,
  skip,
  stopSkipping,
  updateQueuedViews,
} from '#details/details-queue';
import { pruneCatalog } from '#writes/pruning';
import { expect, test } from 'vitest';

test('names sort as people read them', () => {
  const names = ['IMG_10.jpg', 'img_9.jpg', 'Élan.jpg', 'elan2.jpg', 'IMG_009b.jpg', 'b.jpg'];
  expect(names.toSorted((left, right) => (nameKey(left) < nameKey(right) ? -1 : 1))).toEqual([
    'b.jpg',
    'Élan.jpg',
    'elan2.jpg',
    'img_9.jpg',
    'IMG_009b.jpg',
    'IMG_10.jpg',
  ]);
});

test("folders' keys sort each folder before the folders inside it and those named after it", () => {
  const folders = ['a b', 'a/b', 'A', '.', 'a/b/c', 'a0'];
  expect(folders.toSorted((left, right) => (parentKey(left) < parentKey(right) ? -1 : 1))).toEqual([
    '.',
    'A',
    'a/b',
    'a/b/c',
    'a b',
    'a0',
  ]);
});

test('a write says whether it changed any row, which one of what the catalog has does not', () => {
  const catalog = openCatalog();
  expect(catalog.write([{ listed: [entry('trips'), entry('trips/a.jpg')] }]).changed).toBe(true);
  expect(catalog.write([{ indexed: 'trips' }]).changed).toBe(true);

  const again = catalog.write([
    { listed: [entry('trips'), entry('trips/a.jpg')] },
    { indexed: 'trips' },
    { removed: ['trips/gone.jpg'] },
  ]);
  expect(again).toMatchObject({ changed: false, folders: [], tiles: [] });

  const changed = entry('trips/a.jpg', { metadata: changedAt(2000) });
  expect(catalog.write([{ listed: [changed] }]).changed).toBe(true);
});

test("a write says whether it changed only photos' details, which most views never read", () => {
  const catalog = openCatalog();
  expect(catalog.write([{ listed: [entry('a.jpg')] }]).onlyDetails).toBe(false);
  const read = { details: [details('a.jpg', { camera: 'Canon EOS R5' })] };
  expect(catalog.write([read])).toMatchObject({ changed: true, onlyDetails: true });
  expect(catalog.write([read, { listed: [entry('b.jpg')] }]).onlyDetails).toBe(false);
  const unreadable = { unreadable: [{ id: 'b.jpg', modifiedMs: 1000, size: 50 }] };
  expect(catalog.write([unreadable])).toMatchObject({ changed: true, onlyDetails: true });
});

test("a folder's stamp is kept once it is read, until a failed read forgets it", () => {
  const catalog = openCatalog();
  const stamp = { changedMs: 2000.5, inode: '42', modifiedMs: 1000.25 };
  catalog.write([{ listed: [entry('trips')] }]);
  // Only a folder read to the end has one.
  catalog.write([{ readMs: 1000, stamp, stamped: 'trips' }]);
  expect(folderStamp(catalog.db, catalog.library, 'trips')).toBeNull();

  const read = [{ indexed: 'trips' }, { readMs: 1000, stamp, stamped: 'trips' }];
  expect(catalog.write(read).changed).toBe(true);
  expect(folderStamp(catalog.db, catalog.library, 'trips')).toEqual(stamp);
  // The same stamp again changes no row views show, so they stay as they are.
  expect(catalog.write([{ readMs: 2000, stamp, stamped: 'trips' }]).changed).toBe(false);

  catalog.write([{ readMs: 3000, stamp: null, stamped: 'trips' }]);
  expect(folderStamp(catalog.db, catalog.library, 'trips')).toBeNull();
  expect(isIndexed(catalog.db, catalog.library, 'trips')).toBe(true);
  expect(catalog.write([{ readMs: 3000, stamp: null, stamped: 'trips' }]).changed).toBe(false);
});

test('a folder keeps when its last read with nothing failing began, which a failed read leaves', () => {
  const catalog = openCatalog();
  const stamp = { changedMs: 2000.5, inode: '42', modifiedMs: 1000.25 };
  catalog.write([{ listed: [entry('trips')] }, { indexed: 'trips' }]);
  expect(folderReadMs(catalog.db, catalog.library, 'trips')).toBeNull();

  catalog.write([{ readMs: 1000, stamp, stamped: 'trips' }]);
  expect(folderReadMs(catalog.db, catalog.library, 'trips')).toBe(1000);
  catalog.write([{ readMs: 2000, stamp, stamped: 'trips' }]);
  expect(folderReadMs(catalog.db, catalog.library, 'trips')).toBe(2000);
  catalog.write([{ readMs: 3000, stamp: null, stamped: 'trips' }]);
  expect(folderReadMs(catalog.db, catalog.library, 'trips')).toBe(2000);
});

test('a library keeps when a full read began, until one gets to the end', () => {
  const catalog = openCatalog();
  expect(fullReads(catalog.db, catalog.library)).toEqual({ lastMs: null, startedMs: null });
  catalog.write([{ fullReadStarted: 1000 }]);
  expect(fullReads(catalog.db, catalog.library)).toEqual({ lastMs: null, startedMs: 1000 });
  catalog.write([{ fullRead: 3000 }]);
  expect(fullReads(catalog.db, catalog.library)).toEqual({ lastMs: 3000, startedMs: null });
});

test('a listing of a file that changed drops its details and tags', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('a.jpg')] }]);
  catalog.write([{ details: [details('a.jpg', { camera: 'Canon', tags: ['Beach'] })] }]);
  expect(photosTagged(catalog.db, catalog.library, ['Beach'])).toHaveLength(1);

  // Listed again as it was: the details stay.
  expect(catalog.write([{ listed: [entry('a.jpg')] }]).newlyUnread).toEqual([]);
  expect(
    entriesInOrder(catalog.db, photosTagged(catalog.db, catalog.library, ['Beach']))[0]?.exif
      ?.camera,
  ).toBe('Canon');

  const changed = entry('a.jpg', {
    metadata: { ...changedAt(2000), inode: '42' },
  });
  const { newlyUnread } = catalog.write([{ listed: [changed] }]);
  expect(newlyUnread).toHaveLength(1);
  // The entry says its inode, which names its thumbnail for the window.
  expect(entriesInOrder(catalog.db, newlyUnread)[0]?.metadata?.inode).toBe('42');
  expect(photosTagged(catalog.db, catalog.library, ['Beach'])).toEqual([]);
  expect(knownItemsAt(catalog.db, catalog.library, ['a.jpg'])).toEqual([
    { id: 'a.jpg', inode: '42', kind: 'image', modifiedMs: 2000, size: 50 },
  ]);
});

test('details read before a file changed are left out', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('a.jpg')] }]);
  const { changedSinceRead } = catalog.write([
    { details: [details('a.jpg', { camera: 'Canon' }, 51)] },
  ]);
  expect(changedSinceRead).toEqual([itemOf(catalog.db, catalog.library, 'a.jpg')]);
  expect(countUnread(catalog.db, catalog.library, { directoryId: '.', recursive: true })).toBe(1);
});

test('a photo whose details could not be read is done with until its file changes', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: [entry('a.jpg'), entry('b.jpg')] }]);
  const everything = { directoryId: '.', recursive: true };
  const next = () => nextUnread(catalog.db, catalog.library, detailsQueue(), 10, []);
  expect(
    catalog.write([{ unreadable: [{ id: 'a.jpg', modifiedMs: 1000, size: 50 }] }]).changedSinceRead,
  ).toEqual([]);
  expect(next().map(({ id }) => id)).toEqual(['b.jpg']);
  expect(countUnread(catalog.db, catalog.library, everything)).toBe(1);
  // It shows as a photo with no details, rather than one waiting for them.
  expect(
    entriesInOrder(catalog.db, [itemOf(catalog.db, catalog.library, 'a.jpg') ?? 0])[0]?.exif,
  ).toEqual({});

  // Listed as it was, it stays done with; changed, it is tried again.
  expect(catalog.write([{ listed: [entry('a.jpg')] }]).newlyUnread).toEqual([]);
  catalog.write([{ listed: [entry('a.jpg', { metadata: changedAt(2000) })] }]);
  expect(next().map(({ id }) => id)).toEqual(['a.jpg', 'b.jpg']);

  // Its file changed since it failed, so the mark is left out, and the photo skipped for now.
  const { changedSinceRead } = catalog.write([
    { unreadable: [{ id: 'a.jpg', modifiedMs: 1000, size: 50 }] },
  ]);
  expect(changedSinceRead).toEqual([itemOf(catalog.db, catalog.library, 'a.jpg')]);
  expect(countUnread(catalog.db, catalog.library, everything)).toBe(2);
});

test('forgetting every photo’s details forgets which could not be read', () => {
  const catalog = openCatalog();
  catalog.write([
    { listed: [entry('a.jpg')] },
    { unreadable: [{ id: 'a.jpg', modifiedMs: 1000, size: 50 }] },
  ]);
  forgetAllDetails(catalog.db);
  expect(
    nextUnread(catalog.db, catalog.library, detailsQueue(), 10, []).map(({ id }) => id),
  ).toEqual(['a.jpg']);
});

test('a photo whose details could not be read leaves none as its row goes', () => {
  const catalog = openCatalog();
  catalog.write([
    { listed: [entry('a.jpg', { metadata: { ...changedAt(1000), inode: '42' } })] },
    { unreadable: [{ id: 'a.jpg', modifiedMs: 1000, size: 50 }] },
  ]);
  catalog.write([{ removed: ['a.jpg'] }]);
  // So the file listed again, as moved, is tried again rather than taking back nothing.
  expect(
    catalog.write([
      {
        recalled: [
          { file: '/library/b.jpg', id: 'b.jpg', inode: '42', modifiedMs: 1000, size: 50 },
        ],
      },
    ]).toRead,
  ).toEqual(['b.jpg']);
});

test('removing a folder removes everything inside it, and no other folder', () => {
  const catalog = openCatalog();
  catalog.write([
    { listed: [entry('a'), entry('a/b'), entry('a/b/c.jpg'), entry('a/d.jpg'), entry('ab.jpg')] },
    { indexed: 'a' },
    { indexed: 'a/b' },
  ]);
  catalog.write([{ removed: ['a'] }]);
  expect(
    knownItemsAt(catalog.db, catalog.library, ['a', 'a/b', 'a/b/c.jpg', 'a/d.jpg', 'ab.jpg']).map(
      ({ id }) => id,
    ),
  ).toEqual(['ab.jpg']);
  expect(isIndexed(catalog.db, catalog.library, 'a')).toBe(false);
  expect(isIndexed(catalog.db, catalog.library, 'a/b')).toBe(false);
});

test('pruning drops the libraries used longest ago, never the one opened', () => {
  const database = openDatabase();
  for (const [index, root] of ['/old', '/recent', '/open'].entries()) {
    const catalog = openCatalog(root, database);
    catalog.write([{ listed: [entry('a.jpg'), entry('b.jpg'), entry('c.jpg')] }]);
    database.prepare('UPDATE libraries SET used_ms = ? WHERE root = ?').run(index, root);
  }
  pruneCatalog(catalogDatabase(database), '/open', 4);
  const roots = database.prepare('SELECT root FROM libraries ORDER BY root').all();
  expect(roots.map((row) => row.root)).toEqual(['/open', '/recent']);
  expect(database.prepare('SELECT count(*) AS count FROM items').get()?.count).toBe(6);

  // However large it is, the library being opened stays.
  pruneCatalog(catalogDatabase(database), '/open', 0);
  expect(database.prepare('SELECT root FROM libraries').all()).toEqual([{ root: '/open' }]);
});

test('details are read for what the window shows, then the view, then the library', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      listed: [
        ...Array.from({ length: 6 }, (_photo, index) => entry(`a/${index}.jpg`)),
        entry('b/library.jpg'),
      ],
    },
  ]);
  const views = catalog.views();
  const queue = detailsQueue();
  const { version } = views.openNow('view', spec({ directoryId: 'a' }));
  views.rows('view', version, 4, 2);
  const queued = updateQueuedViews([], views.byUse());
  const ids = (limit: number) =>
    nextUnread(catalog.db, catalog.library, queue, limit, queued).map(({ id }) => id);
  expect(ids(2)).toEqual(['a/4.jpg', 'a/5.jpg']);
  expect(ids(4).slice(2)).toEqual(['a/0.jpg', 'a/1.jpg']);
  expect(ids(10)).toHaveLength(7);
  expect(ids(10).at(-1)).toBe('b/library.jpg');

  // Photos that could not be read wait for a read that lists them afresh.
  const unreadable = itemOf(catalog.db, catalog.library, 'a/4.jpg') ?? 0;
  skip(queue, [unreadable]);
  expect(ids(10)).not.toContain('a/4.jpg');
  stopSkipping(queue, [unreadable]);
  expect(ids(1)).toEqual(['a/4.jpg']);
});

test('the library is looked through once, then again from the start', () => {
  const catalog = openCatalog();
  catalog.write([{ listed: ['a.jpg', 'b.jpg', 'c.jpg'].map((id) => entry(id)) }]);
  const queue = detailsQueue();
  const next = () => nextUnread(catalog.db, catalog.library, queue, 2, []).map(({ id }) => id);
  expect(next()).toEqual(['a.jpg', 'b.jpg']);
  catalog.write([{ details: [details('a.jpg', {}), details('b.jpg', {})] }]);
  expect(next()).toEqual(['c.jpg']);
  catalog.write([{ details: [details('c.jpg', {})] }]);
  expect(next()).toEqual([]);

  // A file that changed is read again, though the library was looked through past it.
  catalog.write([{ listed: [entry('a.jpg', { metadata: changedAt(9, 1) })] }]);
  expect(next()).toEqual(['a.jpg']);
});

test('a write tells of the folders whose subfolders it added or removed, apart from tiles', () => {
  const catalog = openCatalog();
  expect(catalog.write([{ listed: [entry('Trips'), entry('Trips/Beach')] }]).folders).toEqual([
    '.',
    'Trips',
  ]);
  // A photo changes tiles, but no folder's subfolders.
  const photo = catalog.write([{ listed: [entry('Trips/Beach/a.jpg')] }]);
  expect(photo).toMatchObject({ folders: [], tiles: ['Trips/Beach', 'Trips', '.'] });
  expect(catalog.write([{ removed: ['Trips/Beach/a.jpg'] }]).folders).toEqual([]);
  expect(catalog.write([{ removed: ['Trips/Beach'] }]).folders).toEqual(['Trips']);
});
