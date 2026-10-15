import type { PhotoEntry, PhotoMetadata } from '@app/shared';

export type SortOrder = 'name' | 'modified' | 'created' | 'size';
export type ViewMode = 'grid' | 'filmstrip';

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
