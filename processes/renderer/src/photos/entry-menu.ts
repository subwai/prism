import type { PhotoEntry } from '@app/shared';
import type { MouseEvent } from 'react';

/** Shows the system's right-click menu for `entry`, such as to reveal it in Finder. */
export function showEntryMenu(event: MouseEvent, entry: Pick<PhotoEntry, 'id'>) {
  event.preventDefault();
  // A folder closed meanwhile has no menu to show.
  globalThis.app.photos.showEntryMenu(entry.id).catch(() => null);
}
