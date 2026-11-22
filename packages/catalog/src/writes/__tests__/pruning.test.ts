import { entry, openCatalog, openDatabase } from '#__tests__/fixtures';
import { catalogDatabase } from '#data/database';
import { pruneCatalog } from '#writes/pruning';
import { expect, test } from 'vitest';

test('pruning drops the libraries used longest ago, never the one opened', () => {
  const database = openDatabase();
  for (const [index, root] of ['/old', '/recent', '/open'].entries()) {
    const catalog = openCatalog(root, database);
    catalog.write([{ entries: [entry('a.jpg'), entry('b.jpg'), entry('c.jpg')], kind: 'list' }]);
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
