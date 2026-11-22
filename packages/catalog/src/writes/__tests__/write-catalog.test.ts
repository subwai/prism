import { changedAt, details, entry, openCatalog } from '#__tests__/fixtures';
import { countUnread, forgetAllDetails } from '#data/details';
import { photosTagged } from '#data/filters';
import { folderReadMs, folderStamp, isIndexed } from '#data/indexed-folders';
import { entriesInOrder, itemOf, knownItemsAt } from '#data/items';
import { fullReads } from '#data/libraries';
import { detailsQueue, nextUnread } from '#details/details-queue';
import type { CatalogWrite } from '#writes/write-catalog';
import { expect, test } from 'vitest';

test('a write says whether it changed any row, which one of what the catalog has does not', () => {
  const catalog = openCatalog();
  expect(
    catalog.write([{ entries: [entry('trips'), entry('trips/a.jpg')], kind: 'list' }]).changed,
  ).toBe(true);
  expect(catalog.write([{ folderId: 'trips', kind: 'markIndexed' }]).changed).toBe(true);

  const again = catalog.write([
    { entries: [entry('trips'), entry('trips/a.jpg')], kind: 'list' },
    { folderId: 'trips', kind: 'markIndexed' },
    { ids: ['trips/gone.jpg'], kind: 'remove' },
  ]);
  expect(again).toMatchObject({ changed: false, folders: [], tiles: [] });

  const changed = entry('trips/a.jpg', { metadata: changedAt(2000) });
  expect(catalog.write([{ entries: [changed], kind: 'list' }]).changed).toBe(true);
});

test("a write says whether it changed only photos' details, which most views never read", () => {
  const catalog = openCatalog();
  expect(catalog.write([{ entries: [entry('a.jpg')], kind: 'list' }]).onlyDetails).toBe(false);
  const read: CatalogWrite = {
    details: [details('a.jpg', { camera: 'Canon EOS R5' })],
    kind: 'storeDetails',
  };
  expect(catalog.write([read])).toMatchObject({ changed: true, onlyDetails: true });
  expect(catalog.write([read, { entries: [entry('b.jpg')], kind: 'list' }]).onlyDetails).toBe(
    false,
  );
  const unreadable: CatalogWrite = {
    files: [{ id: 'b.jpg', modifiedMs: 1000, size: 50 }],
    kind: 'markUnreadable',
  };
  expect(catalog.write([unreadable])).toMatchObject({ changed: true, onlyDetails: true });
});

test("a folder's stamp is kept once it is read, until a failed read forgets it", () => {
  const catalog = openCatalog();
  const stamp = { changedMs: 2000.5, inode: '42', modifiedMs: 1000.25 };
  catalog.write([{ entries: [entry('trips')], kind: 'list' }]);
  // Only a folder read to the end has one.
  catalog.write([{ folderId: 'trips', kind: 'stamp', readMs: 1000, stamp }]);
  expect(folderStamp(catalog.db, catalog.library, 'trips')).toBeNull();

  const read: CatalogWrite[] = [
    { folderId: 'trips', kind: 'markIndexed' },
    { folderId: 'trips', kind: 'stamp', readMs: 1000, stamp },
  ];
  expect(catalog.write(read).changed).toBe(true);
  expect(folderStamp(catalog.db, catalog.library, 'trips')).toEqual(stamp);
  // The same stamp again changes no row views show, so they stay as they are.
  expect(catalog.write([{ folderId: 'trips', kind: 'stamp', readMs: 2000, stamp }]).changed).toBe(
    false,
  );

  catalog.write([{ folderId: 'trips', kind: 'stamp', readMs: 3000, stamp: null }]);
  expect(folderStamp(catalog.db, catalog.library, 'trips')).toBeNull();
  expect(isIndexed(catalog.db, catalog.library, 'trips')).toBe(true);
  expect(
    catalog.write([{ folderId: 'trips', kind: 'stamp', readMs: 3000, stamp: null }]).changed,
  ).toBe(false);
});

test('a folder keeps when its last read with nothing failing began, which a failed read leaves', () => {
  const catalog = openCatalog();
  const stamp = { changedMs: 2000.5, inode: '42', modifiedMs: 1000.25 };
  catalog.write([
    { entries: [entry('trips')], kind: 'list' },
    { folderId: 'trips', kind: 'markIndexed' },
  ]);
  expect(folderReadMs(catalog.db, catalog.library, 'trips')).toBeNull();

  catalog.write([{ folderId: 'trips', kind: 'stamp', readMs: 1000, stamp }]);
  expect(folderReadMs(catalog.db, catalog.library, 'trips')).toBe(1000);
  catalog.write([{ folderId: 'trips', kind: 'stamp', readMs: 2000, stamp }]);
  expect(folderReadMs(catalog.db, catalog.library, 'trips')).toBe(2000);
  catalog.write([{ folderId: 'trips', kind: 'stamp', readMs: 3000, stamp: null }]);
  expect(folderReadMs(catalog.db, catalog.library, 'trips')).toBe(2000);
});

test('a library keeps when a full read began, until one gets to the end', () => {
  const catalog = openCatalog();
  expect(fullReads(catalog.db, catalog.library)).toEqual({ lastMs: null, startedMs: null });
  catalog.write([{ at: 1000, kind: 'startFullRead' }]);
  expect(fullReads(catalog.db, catalog.library)).toEqual({ lastMs: null, startedMs: 1000 });
  catalog.write([{ at: 3000, kind: 'finishFullRead' }]);
  expect(fullReads(catalog.db, catalog.library)).toEqual({ lastMs: 3000, startedMs: null });
});

test('a listing of a file that changed drops its details and tags', () => {
  const catalog = openCatalog();
  catalog.write([{ entries: [entry('a.jpg')], kind: 'list' }]);
  catalog.write([
    { details: [details('a.jpg', { camera: 'Canon', tags: ['Beach'] })], kind: 'storeDetails' },
  ]);
  expect(photosTagged(catalog.db, catalog.library, ['Beach'])).toHaveLength(1);

  // Listed again as it was: the details stay.
  expect(catalog.write([{ entries: [entry('a.jpg')], kind: 'list' }]).newlyUnread).toEqual([]);
  expect(
    entriesInOrder(catalog.db, photosTagged(catalog.db, catalog.library, ['Beach']))[0]?.exif
      ?.camera,
  ).toBe('Canon');

  const changed = entry('a.jpg', {
    metadata: { ...changedAt(2000), inode: '42' },
  });
  const { newlyUnread } = catalog.write([{ entries: [changed], kind: 'list' }]);
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
  catalog.write([{ entries: [entry('a.jpg')], kind: 'list' }]);
  const { changedSinceRead } = catalog.write([
    { details: [details('a.jpg', { camera: 'Canon' }, 51)], kind: 'storeDetails' },
  ]);
  expect(changedSinceRead).toEqual([itemOf(catalog.db, catalog.library, 'a.jpg')]);
  expect(countUnread(catalog.db, catalog.library, { directoryId: '.', recursive: true })).toBe(1);
});

test('a photo whose details could not be read is done with until its file changes', () => {
  const catalog = openCatalog();
  catalog.write([{ entries: [entry('a.jpg'), entry('b.jpg')], kind: 'list' }]);
  const everything = { directoryId: '.', recursive: true };
  const next = () =>
    nextUnread(catalog.db, catalog.library, { limit: 10, queue: detailsQueue(), views: [] });
  expect(
    catalog.write([
      { files: [{ id: 'a.jpg', modifiedMs: 1000, size: 50 }], kind: 'markUnreadable' },
    ]).changedSinceRead,
  ).toEqual([]);
  expect(next().map(({ id }) => id)).toEqual(['b.jpg']);
  expect(countUnread(catalog.db, catalog.library, everything)).toBe(1);
  // It shows as a photo with no details, rather than one waiting for them.
  expect(
    entriesInOrder(catalog.db, [itemOf(catalog.db, catalog.library, 'a.jpg') ?? 0])[0]?.exif,
  ).toEqual({});

  // Listed as it was, it stays done with; changed, it is tried again.
  expect(catalog.write([{ entries: [entry('a.jpg')], kind: 'list' }]).newlyUnread).toEqual([]);
  catalog.write([{ entries: [entry('a.jpg', { metadata: changedAt(2000) })], kind: 'list' }]);
  expect(next().map(({ id }) => id)).toEqual(['a.jpg', 'b.jpg']);

  // Its file changed since it failed, so the mark is left out, and the photo skipped for now.
  const { changedSinceRead } = catalog.write([
    { files: [{ id: 'a.jpg', modifiedMs: 1000, size: 50 }], kind: 'markUnreadable' },
  ]);
  expect(changedSinceRead).toEqual([itemOf(catalog.db, catalog.library, 'a.jpg')]);
  expect(countUnread(catalog.db, catalog.library, everything)).toBe(2);
});

test('forgetting every photo’s details forgets which could not be read', () => {
  const catalog = openCatalog();
  catalog.write([
    { entries: [entry('a.jpg')], kind: 'list' },
    { files: [{ id: 'a.jpg', modifiedMs: 1000, size: 50 }], kind: 'markUnreadable' },
  ]);
  forgetAllDetails(catalog.db);
  expect(
    nextUnread(catalog.db, catalog.library, { limit: 10, queue: detailsQueue(), views: [] }).map(
      ({ id }) => id,
    ),
  ).toEqual(['a.jpg']);
});

test('a photo whose details could not be read leaves none as its row goes', () => {
  const catalog = openCatalog();
  catalog.write([
    { entries: [entry('a.jpg', { metadata: { ...changedAt(1000), inode: '42' } })], kind: 'list' },
    { files: [{ id: 'a.jpg', modifiedMs: 1000, size: 50 }], kind: 'markUnreadable' },
  ]);
  catalog.write([{ ids: ['a.jpg'], kind: 'remove' }]);
  // So the file listed again, as moved, is tried again rather than taking back nothing.
  expect(
    catalog.write([
      {
        kind: 'reuseDetails',
        photos: [{ file: '/library/b.jpg', id: 'b.jpg', inode: '42', modifiedMs: 1000, size: 50 }],
      },
    ]).toRead,
  ).toEqual(['b.jpg']);
});

test('removing a folder removes everything inside it, and no other folder', () => {
  const catalog = openCatalog();
  catalog.write([
    {
      entries: [entry('a'), entry('a/b'), entry('a/b/c.jpg'), entry('a/d.jpg'), entry('ab.jpg')],
      kind: 'list',
    },
    { folderId: 'a', kind: 'markIndexed' },
    { folderId: 'a/b', kind: 'markIndexed' },
  ]);
  catalog.write([{ ids: ['a'], kind: 'remove' }]);
  expect(
    knownItemsAt(catalog.db, catalog.library, ['a', 'a/b', 'a/b/c.jpg', 'a/d.jpg', 'ab.jpg']).map(
      ({ id }) => id,
    ),
  ).toEqual(['ab.jpg']);
  expect(isIndexed(catalog.db, catalog.library, 'a')).toBe(false);
  expect(isIndexed(catalog.db, catalog.library, 'a/b')).toBe(false);
});

test('a write tells of the folders whose subfolders it added or removed, apart from tiles', () => {
  const catalog = openCatalog();
  expect(
    catalog.write([{ entries: [entry('Trips'), entry('Trips/Beach')], kind: 'list' }]).folders,
  ).toEqual(['.', 'Trips']);
  // A photo changes tiles, but no folder's subfolders.
  const photo = catalog.write([{ entries: [entry('Trips/Beach/a.jpg')], kind: 'list' }]);
  expect(photo).toMatchObject({ folders: [], tiles: ['Trips/Beach', 'Trips', '.'] });
  expect(catalog.write([{ ids: ['Trips/Beach/a.jpg'], kind: 'remove' }]).folders).toEqual([]);
  expect(catalog.write([{ ids: ['Trips/Beach'], kind: 'remove' }]).folders).toEqual(['Trips']);
});
