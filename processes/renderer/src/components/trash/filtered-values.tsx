import { filteredValues } from '#data/trash';
import { cn } from '@prism/design-system';
import type { PhotoFilter, TrashEntry } from '@prism/shared';

/** How `entry` stands against the filter the plan is of: its stars, camera or tags. */
export function FilteredValues({ entry, filter }: { entry: TrashEntry; filter: PhotoFilter }) {
  return filteredValues(entry, filter).map(({ field, text }) => (
    <span
      key={`${field}:${text}`}
      className={cn(
        'shrink-0 text-sm',
        field === 'rating' && text !== 'Unrated' ? 'text-rating' : 'text-label-secondary',
      )}
    >
      {text}
    </span>
  ));
}
