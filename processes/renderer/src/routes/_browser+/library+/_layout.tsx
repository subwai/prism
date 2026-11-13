import { EntryMenu } from '#components/entry-menu';
import { FolderMissing } from '#components/folder-missing';
import { FolderTree } from '#components/folder-tree/folder-tree';
import { QueryValue } from '#components/query-value';
import { TrashToast } from '#components/trash/trash-toast';
import { VIEW_MODES } from '#data/entries';
import { openingURL } from '#data/last-view';
import { followRenames } from '#data/renames';
import { loadLibrary, openLibrary, requireLibrary } from '#data/session';
import { isSessionIntent, sessionAction } from '#data/session-actions';
import { readTrail } from '#data/trails';
import { folderURL } from '#data/urls';
import { useFolderChanges } from '#hooks/use-folder-changes';
import { LibraryContext } from '#hooks/use-library';
import type { Route } from '#types/routes/_browser+/library+/+types/_layout';
import { EmptyState } from '@prism/design-system';
import { QueryClientProvider } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import {
  Outlet,
  redirect,
  type ShouldRevalidateFunctionArgs,
  useLocation,
  useNavigate,
  useRouteError,
} from 'react-router';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const library = await loadLibrary();
  // Every folder the catalog knows, and those the tree had open, so the tree shows whole on
  // its first frame, however large the library and however slow its disk.
  await library.tree.read();
  const folderId = new URL(request.url).searchParams.get('folder') ?? library.root.id;
  await readTrail(library, folderId);
  // The window needs the root's listing to show anything, and whether the folder is there.
  await library.directory(library.root.id);
  return { library };
}
/**
 * The tree reads the folders around the open one, so only another folder, or an action such as
 * a rename or refresh, needs them read again; previews, searches and ratings change nothing here,
 * nor do runs to the Trash, whose changes the watcher brings.
 */
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (isSessionIntent(formData?.get('intent'))) {
    return false;
  }
  return formMethod
    ? defaultShouldRevalidate
    : currentUrl.searchParams.get('folder') !== nextUrl.searchParams.get('folder');
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  if (form.get('intent') === 'rename') {
    const result = await requireLibrary().rename(
      String(form.get('entryId')),
      String(form.get('name')).trim(),
    );
    // A renamed open folder reloads the view, which then follows it to its new name.
    return 'error' in result ? result : { refreshed: result.lost, renamed: result.entry };
  }
  if (isSessionIntent(form.get('intent'))) {
    return sessionAction(requireLibrary(), form);
  }
  if (form.get('intent') === 'refresh') {
    await requireLibrary().refresh();
    // Refresh is a navigation back to the same view, so it gets the router's crossfade.
    const returnTo = String(form.get('returnTo') ?? '');
    return redirect(returnTo.startsWith('/library/') ? returnTo : '/library/grid');
  }
  try {
    if (await openLibrary()) {
      return redirect(await openingURL(requireLibrary()));
    }
    return { cancelled: true };
  } catch {
    return { error: 'Could not open that folder. Please try again.' };
  }
}

export default function Library({ loaderData: { library } }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { renames } = useSyncExternalStore(library.edits.subscribe, library.edits.getSnapshot);
  const location = useLocation();
  const folderId = new URLSearchParams(location.search).get('folder') ?? library.root.id;
  // Until the view follows a renamed folder to its new name, the tree already does.
  const trail = library.trail(folderId) ??
    library.trail(followRenames(renames, folderId)) ?? [library.root];
  const mode = VIEW_MODES.find((view) => location.pathname.endsWith(`/${view}`)) ?? 'grid';
  useFolderChanges(library);
  return (
    <QueryClientProvider client={library.queries}>
      <LibraryContext value={library}>
        <EntryMenu>
          {/* The loader read the root's listing, which a change on disk reads again. */}
          <QueryValue query={library.directoryQuery(library.root.id)}>
            {(listing) =>
              listing?.missing ? (
                <FolderMissing name={library.root.name} />
              ) : (
                <div className="flex min-h-0 flex-1">
                  <FolderTree
                    key={library.id}
                    root={library.root}
                    trail={trail}
                    mode={mode}
                    onNavigate={(next) =>
                      navigate(
                        folderURL(mode, next.at(-1)?.id ?? library.root.id, location.search),
                        { viewTransition: true },
                      )
                    }
                  />
                  <Outlet />
                </div>
              )
            }
          </QueryValue>
          <TrashToast />
        </EntryMenu>
      </LibraryContext>
    </QueryClientProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <main className="flex flex-1 flex-col">
      <EmptyState
        title="Unable to read this folder"
        description={error instanceof Error ? error.message : 'Choose another folder to continue.'}
      />
    </main>
  );
}
