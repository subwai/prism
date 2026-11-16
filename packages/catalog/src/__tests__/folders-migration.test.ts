import {
  beforeFolders,
  FOLDERS,
  libraryIds,
  nameOrderBeforeFolders,
  rowsBeforeFolders,
  statementsOf,
  writeBeforeFolders,
} from '#__tests__/before-folders';
import { entry, openCatalog } from '#__tests__/fixtures';
import { catalogDatabase } from '#data/database';
import { tilesAt } from '#data/folder-summaries';
import { entriesByNumber, itemOf, known } from '#data/items';
import { scopeOrder } from '#data/orders';
import { connectIndex, prepareIndex } from '#photo-index';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, onTestFinished, test } from 'vitest';

async function indexFile() {
  const directory = await mkdtemp(path.join(tmpdir(), 'folders-migration-'));
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  return path.join(directory, 'photo-index.db');
}

test('the folders’ migration keeps every entry’s ID, folder, name, details and tile, and its number', async () => {
  const file = await indexFile();
  const before = beforeFolders(file);
  // Two libraries with the same paths, which each keep their own.
  for (const root of ['/library', '/other']) {
    before.prepare('INSERT INTO libraries (root, used_ms) VALUES (?, 0)').run(root);
  }
  const ids = libraryIds();
  writeBeforeFolders(before, 1, ids);
  writeBeforeFolders(before, 2, ids.slice(0, 500));
  // Numbers past the last entry, as of entries since removed, are never given again.
  before.exec("UPDATE sqlite_sequence SET seq = seq + 100 WHERE name = 'items'");
  const rows = rowsBeforeFolders(before);
  const lastNumber = before.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'items'").get();
  const byName = [1, 2].map((library) => nameOrderBeforeFolders(before, library));
  const inTree = nameOrderBeforeFolders(before, 1, '2020');
  before.close();
  expect(rows.length).toBeGreaterThan(2000);

  expect(prepareIndex(file)).toBe(file);
  const database = connectIndex(file);
  onTestFinished(() => database.close());
  const db = catalogDatabase(database);
  const found = entriesByNumber(
    db,
    rows.map((row) => Number(row.item)),
  );
  const tiles = new Map<string, unknown>(
    [1, 2].flatMap((library) =>
      tilesAt(db, library, ids).map((tile) => [`${library}:${tile.id}`, tile.summary] as const),
    ),
  );
  for (const row of rows) {
    expect(found.get(Number(row.item))).toMatchObject({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
    });
    expect(itemOf(db, Number(row.library), String(row.id))).toBe(row.item);
    if (row.kind === 0) {
      expect(tiles.get(`${String(row.library)}:${String(row.id)}`)).toEqual({
        covers: JSON.parse(String(row.covers)),
        hasEntries: row.has_entries === 1,
        hasSubfolders: row.has_subfolders === 1,
      });
    }
  }
  const after = database
    .prepare(`SELECT item, library, size, modified_ms, exif_read, exif, rating, inode, has_entries,
      has_subfolders, covers FROM items ORDER BY item`)
    .all();
  expect(after).toEqual(
    rows.map(({ id: _id, parentId: _parentId, name: _name, kind: _kind, ...rest }) => rest),
  );
  expect(database.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'items'").get()).toEqual(
    lastNumber,
  );
  for (const [index, library] of [1, 2].entries()) {
    const order = scopeOrder(db, library, { directoryId: '.', recursive: true }, 'name');
    expect([...order.items]).toEqual(byName[index]);
  }
  const tree = scopeOrder(db, 1, { directoryId: '2020', recursive: true }, 'name');
  expect([...tree.items]).toEqual(inTree);

  // The triggers are in, as are the tags' own.
  const catalog = openCatalog('/library', database);
  catalog.write([{ listed: [entry('Lost/Found/z'), entry('Lost/Found/z/1.jpg')] }]);
  expect(known(db, 1, ['Lost/Found/z/1.jpg']).map(({ id }) => id)).toEqual(['Lost/Found/z/1.jpg']);
  expect(
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all(),
  ).toHaveLength(7);
});

test('the folders’ migration copies the entries through its index of paths, in order of number', () => {
  const database = beforeFolders(':memory:');
  onTestFinished(() => database.close());
  const statements = statementsOf(FOLDERS);
  const plans: string[] = [];
  for (const statement of statements) {
    if (statement.includes('INSERT')) {
      plans.push(
        database
          .prepare(`EXPLAIN QUERY PLAN ${statement}`)
          .all()
          .map((row) => String(row.detail))
          .join('\n'),
      );
    }
    database.exec(statement);
  }
  const [, others = '', copy = ''] = plans;
  // Each entry's folder is a search of `folders`, never a scan, which takes as long as the
  // library has folders for each entry.
  for (const plan of [others, copy]) {
    expect(plan).toMatch(
      /SEARCH folders USING (?:COVERING )?INDEX folders_path \(library=\? AND path=\?\)/u,
    );
  }
  expect(copy).toMatch(/^SCAN items$/mu);
  expect(copy).not.toMatch(/TEMP B-TREE/u);
});
