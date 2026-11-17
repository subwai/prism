import { nameFold, nameKey, parentKey } from '#data/codes';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';

// Indexes as builds before the folders' migration wrote them, to migrate in tests.

/** Each migration's SQL, by its folder's name, oldest first. */
export const MIGRATIONS = Object.entries(
  import.meta.glob<string>('../migrations/*/migration.sql', {
    eager: true,
    import: 'default',
    query: '?raw',
  }),
)
  .map(([file, sql]) => ({ name: file.split('/').at(-2) ?? file, sql }))
  .toSorted((left, right) => left.name.localeCompare(right.name));

export const FOLDERS = '20261116051323_folders';

export function statementsOf(name: string) {
  const migration = MIGRATIONS.find((each) => each.name === name);
  expect(migration).toBeDefined();
  return (migration?.sql ?? '').split('--> statement-breakpoint');
}

/** An index at `file` as builds before the folders' migration left it, with nothing in it. */
export function beforeFolders(file: string) {
  const database = new DatabaseSync(file);
  database.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL,
      created_at numeric, name text, applied_at TEXT)`);
  const record = database.prepare('INSERT INTO __drizzle_migrations (hash, name) VALUES (?, ?)');
  for (const { name, sql } of MIGRATIONS.filter((each) => each.name < FOLDERS)) {
    database.exec(sql.split('--> statement-breakpoint').join('\n'));
    record.run('', name);
  }
  return database;
}

/**
 * How long a test of the migrations' files may take, most of which write a whole library before
 * the folders' migration and then migrate or vacuum it. Alone, each takes well under a second,
 * apart from the one that waits on another worker's upgrade, but on CI, beside the other test
 * files, they have taken longer than Vitest's default of five seconds. Those files set it as their
 * own timeout, so the default stays as it is for the rest.
 */
export const MIGRATION_TESTS_TIMEOUT_MS = 60_000;

/** The IDs of a library shaped as one on disk, a few thousand of them, deepest five folders down. */
export function libraryIds() {
  const ids: string[] = ['notes.txt', 'Ö 10.jpg', 'IMG_9.JPG', 'img_10.jpg'];
  for (const year of ['2019', '2020', '2021', 'Äldre']) {
    ids.push(year);
    for (let event = 0; event < 12; event += 1) {
      const folder = `${year}/${event % 3 === 0 ? 'Ö' : 'Trip'} ${event}`;
      const photos = Array.from(
        { length: 40 },
        (_unused, photo) => `${folder}/IMG_${photo}.${photo % 7 === 0 ? 'mov' : 'jpg'}`,
      );
      const raw =
        event % 4 === 0
          ? [
              `${folder}/RAW`,
              `${folder}/RAW/Best`,
              `${folder}/RAW/Best/a.jpg`,
              ...[1, 2, 3].map((index) => `${folder}/RAW/DSC0${index}.ARW`),
            ]
          : [];
      ids.push(folder, ...photos, ...raw);
    }
  }
  // Entries of folders whose rows were never written, as a read cut short leaves them.
  ids.push('Lost/Found/x.jpg', 'Lost/Found/y.jpg');
  return ids;
}

/** Writes `ids` into `library` as builds before the folders' migration did, a tile on each folder. */
export function writeBeforeFolders(database: DatabaseSync, library: number, ids: string[]) {
  const insert = database.prepare(`INSERT INTO items (library, id, parent_id, name, name_key,
    name_fold, kind, grp, size, modified_ms, exif_read, exif, rating, inode, has_entries,
    has_subfolders, covers, parent_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [index, id] of ids.entries()) {
    const name = path.basename(id);
    const folder = !path.extname(name);
    const parentId = path.dirname(id);
    insert.run(
      library,
      id,
      parentId,
      name,
      nameKey(name),
      nameFold(name),
      folder ? 0 : 1,
      folder ? 0 : 1,
      folder ? null : index,
      folder ? null : 1000 + index,
      folder ? 0 : index % 2,
      index % 2 && !folder ? JSON.stringify({ camera: 'Canon' }) : null,
      index % 5 === 0 ? 3 : null,
      folder ? null : String(index),
      folder ? 1 : null,
      folder ? index % 2 : null,
      folder ? JSON.stringify([index + 1, index + 2]) : null,
      parentKey(parentId),
    );
  }
}

/** Every entry of the index as builds before the folders' migration read it, by number. */
export function rowsBeforeFolders(database: DatabaseSync) {
  return database
    .prepare(`SELECT item, library, id, parent_id AS parentId, name, kind, size, modified_ms,
      exif_read, exif, rating, inode, has_entries, has_subfolders, covers FROM items ORDER BY item`)
    .all();
}

/** The numbers of a library's entries in the sort by name, as builds before it read them. */
export function nameOrderBeforeFolders(database: DatabaseSync, library: number, folderId = '.') {
  const inTree = folderId === '.' ? '' : `AND id >= '${folderId}/' AND id < '${folderId}0'`;
  return database
    .prepare(`SELECT item FROM items WHERE library = ? ${inTree}
      ORDER BY grp, parent_key, name_key, item`)
    .all(library)
    .map((row) => Number(row.item));
}

/** The pages a database's file holds. */
export function pages(database: DatabaseSync): number {
  return Number(database.prepare('PRAGMA page_count').get()?.page_count);
}
