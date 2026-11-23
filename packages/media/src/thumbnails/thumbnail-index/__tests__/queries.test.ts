import { openThumbnailIndex } from '#thumbnails/thumbnail-index/file';
import { leastRecentlyUsed, recordThumbnail } from '#thumbnails/thumbnail-index/queries';
import { expect, test, vi } from 'vitest';

test('pruning reads the thumbnails used longest ago through thumbnails_used', () => {
  const db = openThumbnailIndex(':memory:');
  for (const [key, usedMs] of [
    ['b', 2000],
    ['a', 1000],
    ['c', 3000],
  ] as const) {
    recordThumbnail(db, { key, size: 10, usedMs });
  }
  const plans: string[] = [];
  const database = db.$client;
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

  expect(leastRecentlyUsed(db, 2).map((thumbnail) => thumbnail.key)).toEqual(['a', 'b']);
  // Without the index, pruning sorts every thumbnail in the cache, about 380,000 of them.
  expect(plans.join('\n')).toMatch(/SCAN thumbnails USING INDEX thumbnails_used/u);
});
