import { trashPlaceQuery } from '#data/prism-trash';
import { placeOf, trashButtonLabel } from '#data/trash';
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
  const { data: place = placeOf(library.root.location) } = useQuery(trashPlaceQuery(library));
  return (
    <IconButton label={trashButtonLabel(place)} onClick={onClick}>
      {place.destination === 'delete' ? (
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
