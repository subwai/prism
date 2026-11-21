import { DETAILS_CODES, KIND_CODES } from '#data/codes';
import type { CatalogDatabase } from '#data/database';
import type { DetailsProgress } from '@prism/shared';
import { sql } from 'drizzle-orm';

/**
 * Counts the library's photos, those with their details still to read, and those whose details
 * could not be read, into a table of the connection's own, which triggers of its own then keep
 * current as its writes add, change and remove rows: counting takes a tenth of a second on a
 * library of 1.7 million photos, too long for every write. SQLite keeps the count, rather than
 * each write working out what it changed, as rows change in many ways: listed, read, removed or
 * moved. The table and triggers are `TEMP`, so they last as long as the connection and need no
 * migration, and they hear only its writes, which are every write of its library but another
 * thread forgetting every photo's details, after which this counts again.
 */
export function keepDetailsCount(db: CatalogDatabase, library: number): void {
  // Triggers take no parameters, so the library's number and the kind of a photo are written in.
  const number = Math.trunc(library);
  const photo = `library = ${number} AND kind = ${KIND_CODES.image}`;
  const ours = (row: 'old' | 'new') =>
    `(${row}.library = ${number} AND ${row}.kind = ${KIND_CODES.image})`;
  const reads = (row: 'old' | 'new', code: number) =>
    `(${ours(row)} AND ${row}.exif_read = ${code})`;
  const unread = (row: 'old' | 'new') => reads(row, DETAILS_CODES.unread);
  const unreadable = (row: 'old' | 'new') => reads(row, DETAILS_CODES.unreadable);
  for (const statement of [
    `CREATE TEMP TABLE IF NOT EXISTS details_count
      (photos INTEGER NOT NULL, unread INTEGER NOT NULL, unreadable INTEGER NOT NULL)`,
    `CREATE TEMP TRIGGER IF NOT EXISTS details_count_insert AFTER INSERT ON items
      WHEN ${ours('new')}
      BEGIN
        UPDATE details_count SET photos = photos + 1, unread = unread + ${unread('new')},
          unreadable = unreadable + ${unreadable('new')};
      END`,
    `CREATE TEMP TRIGGER IF NOT EXISTS details_count_delete AFTER DELETE ON items
      WHEN ${ours('old')}
      BEGIN
        UPDATE details_count SET photos = photos - 1, unread = unread - ${unread('old')},
          unreadable = unreadable - ${unreadable('old')};
      END`,
    `CREATE TEMP TRIGGER IF NOT EXISTS details_count_update
      AFTER UPDATE OF library, kind, exif_read ON items
      WHEN ${ours('old')} OR ${ours('new')}
      BEGIN
        UPDATE details_count SET
          photos = photos - ${ours('old')} + ${ours('new')},
          unread = unread - ${unread('old')} + ${unread('new')},
          unreadable = unreadable - ${unreadable('old')} + ${unreadable('new')};
      END`,
    'DELETE FROM details_count',
    // Through `items_kind`, `items_unread` and `items_unreadable`, which each hold what they count.
    `INSERT INTO details_count SELECT
      (SELECT count(*) FROM items WHERE ${photo}),
      (SELECT count(*) FROM items WHERE ${photo} AND exif_read = ${DETAILS_CODES.unread}),
      (SELECT count(*) FROM items WHERE ${photo} AND exif_read = ${DETAILS_CODES.unreadable})`,
  ]) {
    db.run(sql.raw(statement));
  }
}

/**
 * How many of the library's photos have their details read, as `keepDetailsCount` keeps it.
 * Those that could not be read count as read, as they are done with until their files change.
 */
export function detailsCount(db: CatalogDatabase): DetailsProgress {
  const row = db.get<{ photos: number; unread: number; unreadable: number }>(
    sql`SELECT photos, unread, unreadable FROM details_count`,
  );
  const photos = row?.photos ?? 0;
  return { photos, read: photos - (row?.unread ?? 0), unreadable: row?.unreadable ?? 0 };
}
