import { contentsOf, entriesIn, mediaIn, subfoldersOf } from '#data/contents';
import { catalogDatabase } from '#data/database';
import { connectIndex } from '#photo-index';
import { expect, onTestFinished, test, vi } from 'vitest';

test("a folder's own entries are found through the index by parent, never by reading the library", () => {
  const database = connectIndex(':memory:');
  onTestFinished(() => database.close());
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
  const db = catalogDatabase(database);
  entriesIn(db, 1, 'Trips');
  subfoldersOf(db, 1, 'Trips');
  contentsOf(db, 1, 'Trips');
  mediaIn(db, 1, 'Trips', 4);
  expect(plans.length).toBeGreaterThanOrEqual(4);
  for (const plan of plans) {
    // Any other index of the library reads every one of its entries to find the folder's.
    expect(plan).toMatch(/USING (?:COVERING )?INDEX items_parent \(library=\? AND parent_id=\?\)/u);
  }
});
