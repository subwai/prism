import { EntryMenu } from '#components/entry-menu';
import { FolderMissing } from '#components/folder-missing';
import { FolderTree } from '#components/folder-tree/folder-tree';
import { QueryValue } from '#components/query-value';
import { TrashToast } from '#components/trash/trash-toast';
import { VIEW_MODES } from '#data/entries';
import { isSessionIntent, sessionAction } from '#data/session/actions';
import { loadLibrary, openLibrary, requireLibrary } from '#data/session/current-library';
import { trailIn } from '#data/tree/trails';
import { folderURL } from '#data/urls';
import { openingURL } from '#data/views/last-view';
import { useFolderChanges } from '#hooks/use-folder-changes';
import { LibraryContext, useKnownFolders } from '#hooks/use-library';
import type { Route } from '#types/routes/_browser+/library+/+types/_layout';
import { EmptyState } from '@prism/design-system';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  redirect,
  type ShouldRevalidateFunctionArgs,
  useLocation,
  useNavigate,
  useRouteError,
} from 'react-router';

export async function clientLoader() {
  const library = await loadLibrary();
  // Every folder the catalog knows, and those the tree had open, so the tree and the trail to
  // the open folder show whole on the first frame, however large the library. The root's
  // contents say whether the folder is there, as far as this session has read it. Both come
  // from the catalog alone, however slow the disk, or if it is offline.
  await Promise.all([library.tree.readOnce(), library.directory(library.root.id)]);
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

/** Renames an entry. A renamed open folder reloads the view, which then follows it to its new name. */
async function renameEntry(form: FormData) {
  const result = await requireLibrary().rename(
    String(form.get('entryId')),
    String(form.get('name')).trim(),
  );
  return result.kind === 'failed' ? result : { refreshed: result.lost, renamed: result.entry };
}

/**
 * Reads the open folder again. Refresh is a navigation back to the same view, so it gets the
 * router's crossfade.
 */
async function refreshView(form: FormData) {
  await requireLibrary().refresh();
  const returnTo = String(form.get('returnTo') ?? '');
  return redirect(returnTo.startsWith('/library/') ? returnTo : '/library/grid');
}

/** Asks for a folder to open as the library, and goes to where it was last left. */
async function chooseLibrary() {
  try {
    if (await openLibrary()) {
      return redirect(await openingURL(requireLibrary()));
    }
    return { cancelled: true };
  } catch {
    return { error: 'Could not open that folder. Please try again.' };
  }
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const intent = form.get('intent');
  if (isSessionIntent(intent)) {
    return sessionAction(requireLibrary(), form);
  }
  switch (intent) {
    case 'rename': {
      return renameEntry(form);
    }
    case 'refresh': {
      return refreshView(form);
    }
    default: {
      return chooseLibrary();
    }
  }
}

export default function Library({ loaderData: { library } }: Route.ComponentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const folderId = new URLSearchParams(location.search).get('folder') ?? library.root.id;
  // Until the view follows a renamed folder to its new name, the tree already does.
  const trail = trailIn(library.root, useKnownFolders(library), folderId) ?? [library.root];
  const mode = VIEW_MODES.find((view) => location.pathname.endsWith(`/${view}`)) ?? 'grid';
  useFolderChanges(library);
  return (
    <QueryClientProvider client={library.queries}>
      <LibraryContext value={library}>
        <EntryMenu>
          {/* The loader read the root's contents, which reads of the disk read again. */}
          <QueryValue query={library.directoryQuery(library.root.id)}>
            {(contents) =>
              contents?.missing ? (
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
