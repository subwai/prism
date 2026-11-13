import { entry, openCatalog, openDatabase } from '#__tests__/fixtures';
import { everyFolder } from '#data/contents';
import { catalogDatabase } from '#data/database';
import { folderSkeleton } from '#folder-skeleton';
import { expect, test, vi } from 'vitest';

test("the tree's folders are every folder of the library, siblings by name", () => {
  const catalog = openCatalog();
  const other = openCatalog('/other', openDatabase());
  other.write([{ listed: [entry('Elsewhere')] }]);
  catalog.write([
    {
      listed: [
        entry('Trips'),
        entry('Trips/Beach 10'),
        entry('Trips/beach 9'),
        entry('Trips/Beach 10/a.jpg'),
        entry('Album'),
        entry('notes.txt', { kind: 'file' }),
      ],
    },
    { indexed: '.' },
    { indexed: 'Trips' },
  ]);
  expect(folderSkeleton(catalog.db, catalog.library)).toEqual({
    folders: [
      ['Album', '.', 'Album'],
      ['Trips/beach 9', 'Trips', 'beach 9'],
      ['Trips/Beach 10', 'Trips', 'Beach 10'],
      ['Trips', '.', 'Trips'],
    ],
    listed: ['.', 'Trips'],
  });
  // Only the folders inside those asked about, and which of those were read.
  expect(folderSkeleton(catalog.db, catalog.library, ['Trips', 'Album'])).toEqual({
    folders: [
      ['Trips/beach 9', 'Trips', 'beach 9'],
      ['Trips/Beach 10', 'Trips', 'Beach 10'],
    ],
    listed: ['Trips'],
  });
});

test("the library's folders are read in order through the index by name, with nothing to sort", () => {
  const database = openDatabase();
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
  everyFolder(catalogDatabase(database), 1);
  expect(plans.length).toBeGreaterThanOrEqual(1);
  for (const plan of plans) {
    expect(plan).toMatch(/USING INDEX items_name \(library=\? AND grp=\?\)/u);
    expect(plan).not.toMatch(/TEMP B-TREE/u);
  }
});
