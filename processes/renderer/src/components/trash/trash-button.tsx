import { defaultTrashLocation, trashButtonLabel } from '#data/trash/location-labels';
import { trashLocationQuery } from '#data/trash/prism-trash';
import { useLibrary } from '#hooks/use-library';
import { IconButton } from '@prism/design-system';
import { useQuery } from '@tanstack/react-query';
import { Trash2, TriangleAlert } from 'lucide-react';

/**
 * The toolbar's button to move a view's matches to the Trash, which names where they go. Where
 * they would be deleted for good, its icon carries a warning.
 */
export function TrashButton({ onClick }: { onClick: () => void }) {
  const library = useLibrary();
  const { data: trashLocation = defaultTrashLocation(library.root.location) } = useQuery(
    trashLocationQuery(library),
  );
  return (
    <IconButton label={trashButtonLabel(trashLocation)} onClick={onClick}>
      {trashLocation.destination === 'delete' ? (
        <span className="relative">
          <Trash2 />
          <TriangleAlert
            aria-hidden
            className="text-danger fill-surface absolute -right-1.5 -bottom-1 size-2.5!"
          />
        </span>
      ) : (
        <Trash2 />
      )}
    </IconButton>
  );
}
