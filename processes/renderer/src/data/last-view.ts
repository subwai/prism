import { type SortOrder, VIEW_MODES, type ViewMode } from '#data/entries';
import type { LibrarySession } from '#data/library';
import { isBoolean, storedPreferences } from '#data/stored-preferences';
import { sortOrder } from '#data/urls';
import { SORT_ORDERS } from '@prism/shared';

/**
 * How folders were last viewed, which a folder opens with, after a launch too. While one is open,
 * the URL holds them instead.
 */
interface ViewPreferences {
  mode: ViewMode;
  sort: SortOrder;
  descending: boolean;
}

const store = storedPreferences<ViewPreferences>(
  'view-preferences',
  { descending: false, mode: 'grid', sort: 'name' },
  {
    descending: isBoolean,
    mode: (value) => VIEW_MODES.some((mode) => mode === value),
    sort: (value) => SORT_ORDERS.some((order) => order === value),
  },
);

/** The folder each library last told the main process it shows, so it tells only of changes. */
const shown = new WeakMap<LibrarySession, string>();

/**
 * Remembers the view of `directoryId` in `mode`, sorted as `params` say: its mode and sort for
 * whichever folder opens next, and the folder for the next time `library`'s opens.
 */
export function rememberView(
  library: LibrarySession,
  mode: ViewMode,
  params: URLSearchParams,
  directoryId: string,
) {
  store.set({ descending: params.get('order') === 'desc', mode, sort: sortOrder(params) });
  if (shown.get(library) !== directoryId) {
    shown.set(library, directoryId);
    // Losing it only opens the folder at its top.
    library.api.rememberCurrentFolder(library.root.session, directoryId).catch(() => null);
  }
}

/**
 * Where `library` opens: in the mode and sort folders were last viewed with, on the folder last
 * shown inside it. The gallery's loader falls back to the top if that folder has gone.
 */
export async function openingURL(library: LibrarySession) {
  const { descending, mode, sort } = store.current();
  const params = new URLSearchParams();
  const folder = await library.api.currentFolder().catch(() => null);
  if (folder) {
    params.set('folder', folder);
  }
  if (sort !== 'name') {
    params.set('sort', sort);
  }
  if (descending) {
    params.set('order', 'desc');
  }
  return `/library/${mode}?${params}`;
}
