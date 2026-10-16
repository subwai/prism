import { FolderTree } from '#photos/components/folder-tree';
import { loadLibrary, openLibrary, requireLibrary } from '#photos/data/session';
import { folderURL } from '#photos/data/urls';
import { LibraryContext } from '#photos/hooks/use-library';
import type { Route } from '#types/routes/_browser+/library+/+types/_layout';
import { EmptyState } from '@app/design-system';
import { Outlet, redirect, useLocation, useNavigate, useRouteError } from 'react-router';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const library = await loadLibrary();
  // The tree opens the root and the current folder's ancestors, so read their children first.
  const folderId = new URL(request.url).searchParams.get('folder') ?? library.root.id;
  const opened = (library.trail(folderId) ?? [library.root]).slice(0, -1);
  await Promise.all([library.root, ...opened].map((folder) => library.directory(folder.id)));
  return { library };
}
export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  if (form.get('intent') === 'refresh') {
    requireLibrary().refresh();
    // Refresh is a navigation back to the same view, so it gets the router's crossfade.
    const returnTo = String(form.get('returnTo') ?? '');
    return redirect(returnTo.startsWith('/library/') ? returnTo : '/library/grid');
  }
  try {
    if (await openLibrary()) {
      return redirect('/library/grid');
    }
    return { cancelled: true };
  } catch {
    return { error: 'Could not open that folder. Please try again.' };
  }
}

export default function Library({ loaderData: { library } }: Route.ComponentProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const folderId = new URLSearchParams(location.search).get('folder') ?? library.root.id;
  const trail = library.trail(folderId) ?? [library.root];
  const mode = location.pathname.endsWith('filmstrip') ? 'filmstrip' : 'grid';
  return (
    <LibraryContext value={library}>
      <div className="flex min-h-0 flex-1">
        <FolderTree
          key={library.id}
          root={library.root}
          trail={trail}
          mode={mode}
          onNavigate={(next) =>
            navigate(folderURL(mode, next.at(-1)?.id ?? library.root.id, location.search), {
              viewTransition: true
            })
          }
        />
        <Outlet />
      </div>
    </LibraryContext>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return (
    <EmptyState
      title="Unable to read this folder"
      description={error instanceof Error ? error.message : 'Choose another folder to continue.'}
    />
  );
}
