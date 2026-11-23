import { type CatalogDatabase, preparedOnce } from '#database/catalog-database';
import { removedDetails } from '#database/photo-index/schema';
import { matchAll } from '#repositories/queries/sql-helpers';
import type { PhotoExif } from '@prism/shared';
import { eq, lt, sql } from 'drizzle-orm';

/** A file by its inode, which a rename keeps, and the size and modification time it has. */
export interface FileAsRead {
  inode: string;
  size: number;
  modifiedMs: number;
}

/** The file of the placeholders' inode, size and modification time. */
const atPlaceholderFile = matchAll(
  eq(removedDetails.inode, sql.placeholder('inode')),
  eq(removedDetails.size, sql.placeholder('size')),
  eq(removedDetails.modifiedMs, sql.placeholder('modifiedMs')),
);

const removedQuery = preparedOnce((db) =>
  db.select({ exif: removedDetails.exif }).from(removedDetails).where(atPlaceholderFile).prepare(),
);

const dropRemovedQuery = preparedOnce((db) =>
  db.delete(removedDetails).where(atPlaceholderFile).prepare(),
);

/** The details a removed row left of `file`, as it is now. */
export function removedDetailsOf(db: CatalogDatabase, file: FileAsRead): PhotoExif | undefined {
  const row = removedQuery(db).get({ ...file });
  return row && (JSON.parse(row.exif) as PhotoExif);
}

/** Drops the details a removed row left of `file`, as a row holds them again. */
export function dropRemovedDetailsOf(db: CatalogDatabase, file: FileAsRead): void {
  dropRemovedQuery(db).run({ ...file });
}

/** Drops the details of rows removed before `removedMs`. */
export function dropRemovedBefore(db: CatalogDatabase, removedMs: number): void {
  db.delete(removedDetails).where(lt(removedDetails.removedMs, removedMs)).run();
}

/** Drops the details of every removed row. */
export function dropRemovedDetails(db: CatalogDatabase): void {
  db.delete(removedDetails).run();
}
