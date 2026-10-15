import { FolderTree } from '#photos/components/folder-tree';
import { openLibrary, requireLibrary } from '#photos/data/session';
import { folderURL } from '#photos/data/urls';
import { LibraryContext } from '#photos/hooks/use-library';
import type { Route } from '#types/routes/_browser+/library+/+types/_layout';
import { Outlet, redirect, useLocation, useNavigate, useRouteError } from 'react-router';

export function clientLoader() {
  return { library: requireLibrary() };
}
export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  if (form.get('intent') === 'refresh') {
    requireLibrary().refresh();
    return { refreshed: true };
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
      <div className="browser-layout">
        <FolderTree
          key={library.id}
          root={library.root}
          trail={trail}
          mode={mode}
          onNavigate={(next) =>
            navigate(folderURL(mode, next.at(-1)?.id ?? library.root.id, location.search))
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
    <div className="empty-state">
      <h2>Unable to read this folder</h2>
      <p>{error instanceof Error ? error.message : 'Choose another folder to continue.'}</p>
    </div>
  );
}
