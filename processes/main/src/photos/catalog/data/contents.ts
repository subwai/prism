import { KIND_CODES } from '#photos/catalog/data/codes';
import type { CatalogDatabase } from '#photos/catalog/data/database';
import { every, inScope } from '#photos/catalog/data/scope';
import { items } from '#photos/catalog/index-schema';
import { asc, eq, inArray } from 'drizzle-orm';

/** A folder's own entries, which the index of entries by parent finds. */
function directlyIn(library: number, folderId: string) {
  return inScope(library, { directoryId: folderId, recursive: false });
}

/** The numbers of the entries directly inside `folderId`, folders first, then by name. */
export function entriesIn(db: CatalogDatabase, library: number, folderId: string): number[] {
  return db
    .select({ item: items.item })
    .from(items)
    .where(directlyIn(library, folderId))
    .orderBy(asc(items.grp), asc(items.nameKey))
    .all()
    .map((row) => row.item);
}

/** The folders directly inside `folderId`, by name. */
export function subfoldersOf(db: CatalogDatabase, library: number, folderId: string): string[] {
  return db
    .select({ id: items.id })
    .from(items)
    .where(every(directlyIn(library, folderId), eq(items.kind, KIND_CODES.directory)))
    .orderBy(asc(items.nameKey))
    .all()
    .map((row) => row.id);
}

/** Whether `folderId` holds anything, and whether any of it is a folder. */
export function contentsOf(
  db: CatalogDatabase,
  library: number,
  folderId: string,
): { hasEntries: boolean; hasSubfolders: boolean } {
  const [first] = db
    .select({ kind: items.kind })
    .from(items)
    .where(directlyIn(library, folderId))
    .orderBy(asc(items.grp))
    .limit(1)
    .all();
  return { hasEntries: first !== undefined, hasSubfolders: first?.kind === KIND_CODES.directory };
}

/** The numbers of up to `limit` photos and videos directly inside `folderId`: photos first. */
export function mediaIn(
  db: CatalogDatabase,
  library: number,
  folderId: string,
  limit: number,
): number[] {
  return db
    .select({ item: items.item })
    .from(items)
    .where(
      every(
        directlyIn(library, folderId),
        inArray(items.kind, [KIND_CODES.image, KIND_CODES.video]),
      ),
    )
    .orderBy(asc(items.kind), asc(items.nameKey))
    .limit(limit)
    .all()
    .map((row) => row.item);
}
