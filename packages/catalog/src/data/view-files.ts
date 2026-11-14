import { type CatalogDatabase, isIn } from '#data/database';
import { knownColumns, type KnownItem, knownItem } from '#data/items';
import { items } from '#index-schema';

/** What the catalog knows of the entries numbered `numbers`, in that order, leaving out any that are gone. */
export function knownByNumber(db: CatalogDatabase, numbers: number[]): KnownItem[] {
  const rows = db
    .select({ ...knownColumns, item: items.item })
    .from(items)
    .where(isIn(items.item, numbers))
    .all();
  const found = new Map(rows.map(({ item, ...row }) => [item, knownItem(row)]));
  return numbers.flatMap((item) => found.get(item) ?? []);
}
