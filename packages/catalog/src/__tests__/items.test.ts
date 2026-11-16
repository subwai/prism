import { entry, openCatalog, openDatabase } from '#__tests__/fixtures';
import { among, listing } from '#data/items';
import { expect, test, vi } from 'vitest';

test("a folder's listing and entries by ID are found through their indexes, never by reading the library", () => {
  const database = openDatabase();
  const catalog = openCatalog('/library', database);
  const { db, library } = catalog;
  // Folders of photos, videos and folders, as a library holds them. The app never runs
  // `ANALYZE`, so SQLite plans without counts, as it does here.
  const folderIds = ['Trips', 'Album', 'Trips/Beach'];
  const listed = [
    ...folderIds.map((folder) => entry(folder)),
    ...folderIds.flatMap((folder) =>
      Array.from({ length: 55 }, (_entry, index) =>
        index < 50
          ? entry(`${folder}/${index}.jpg`)
          : entry(`${folder}/${index}.mov`, { kind: 'video' }),
      ),
    ),
  ];
  catalog.write([{ listed }]);
  const plans: string[] = [];
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, 'prepare').mockImplementation((text) => {
    plans.push(
      prepare(`EXPLAIN QUERY PLAN ${text}`)
        .all()
        .map((row) => String(row.detail))
        .join('\n'),
    );
    return prepare(text);
  });

  expect(listing(db, library, 'Trips')).toHaveLength(56);
  const listingPlan = plans.splice(0).join('\n');
  // `items_kind` would read every entry of the library to find the folder's.
  expect(listingPlan).toMatch(/SEARCH items USING INDEX items_parent \(parent=\?\)/u);
  expect(listingPlan).not.toMatch(/items_kind/u);

  const asked = ['Trips/1.jpg', 'Trips/Beach/52.mov', 'Album/3.jpg'];
  for (const recursive of [false, true]) {
    for (const directoryId of ['.', 'Trips']) {
      among(db, library, { directoryId, recursive }, asked);
    }
  }
  expect(plans.length).toBeGreaterThanOrEqual(4);
  for (const plan of plans) {
    expect(plan).toMatch(/SEARCH items USING INDEX items_entry \(parent=\? AND name=\?\)/u);
    expect(plan).not.toMatch(/items_kind/u);
  }
  expect(among(db, library, { directoryId: 'Trips', recursive: true }, asked)).toEqual([
    expect.objectContaining({ id: 'Trips/1.jpg', kind: 'image' }),
    expect.objectContaining({ id: 'Trips/Beach/52.mov', kind: 'video' }),
  ]);
});
