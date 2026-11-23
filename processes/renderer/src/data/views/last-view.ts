import { type SortOrder, VIEW_MODES, type ViewMode } from '#data/entries';
import type { LibrarySession } from '#data/library';
import { createStoredPreferences, isBoolean } from '#data/preferences/stored-preferences';
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

const store = createStoredPreferences<ViewPreferences>(
  'view-preferences',
  { descending: false, mode: 'grid', sort: 'name' },
  {
    descending: isBoolean,
    mode: (value) => VIEW_MODES.some((mode) => mode === value),
    sort: (value) => SORT_ORDERS.some((order) => order === value),
  },
);

/** The folder each library last sent the main process, so it sends only changes. */
const rememberedFolders = new WeakMap<LibrarySession, string>();

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
  if (rememberedFolders.get(library) !== directoryId) {
    rememberedFolders.set(library, directoryId);
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
