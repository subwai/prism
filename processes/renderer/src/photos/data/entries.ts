import type { PhotoEntry, PhotoMetadata } from '@app/shared';

export type SortOrder = 'name' | 'modified' | 'created' | 'size';
export type ViewMode = 'grid' | 'filmstrip';

/** Thumbnail sizes a view opens with. */
export const THUMBNAIL_SIZE: Record<ViewMode, number> = { filmstrip: 76, grid: 160 };

/** At most how many entries the window shows at once: a grid fills it, a filmstrip is a row. */
export function screenful(mode: ViewMode) {
  const size = THUMBNAIL_SIZE[mode];
  const columns = Math.ceil(globalThis.innerWidth / size);
  return mode === 'grid' ? columns * Math.ceil(globalThis.innerHeight / size) : columns;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function arrangeEntries(
  entries: PhotoEntry[],
  search: string,
  sort: SortOrder,
  descending: boolean,
  imagesOnly = false
) {
  const query = search.trim().toLocaleLowerCase();
  return entries
    .filter(
      (entry) =>
        (entry.kind === 'image' || (!imagesOnly && entry.kind === 'directory')) &&
        entry.name.toLocaleLowerCase().includes(query)
    )
    .toSorted((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
      }
      let comparison = collator.compare(left.name, right.name);
      if (sort !== 'name') {
        const fields: Record<Exclude<SortOrder, 'name'>, keyof PhotoMetadata> = {
          created: 'createdMs',
          modified: 'modifiedMs',
          size: 'size'
        };
        const field = fields[sort];
        comparison = (left.metadata?.[field] ?? 0) - (right.metadata?.[field] ?? 0) || comparison;
      }
      return (descending ? -1 : 1) * comparison || collator.compare(left.id, right.id);
    });
}

export function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
