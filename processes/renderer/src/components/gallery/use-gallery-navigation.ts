import type { ViewMode } from '#data/entries';
import type { FolderTrail } from '#data/library';
import { folderURL } from '#data/urls';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

/**
 * Moving between folders and views. Each move crossfades once the next view is ready, which
 * history steps replay by themselves. `back`, `forward` and `up` are missing where there is
 * nowhere to go.
 */
export function useGalleryNavigation(mode: ViewMode, trail: FolderTrail) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Re-renders on every navigation; the position in history lives outside React.
  useLocation();
  const position = (globalThis.history.state as { idx?: number } | null)?.idx ?? 0;
  // Only the grid has a preview, so other views leave it behind.
  const go = (folderId: string, view = mode) => {
    const search = new URLSearchParams(params);
    if (view !== 'grid') {
      search.delete('preview');
      search.delete('cover');
    }
    return navigate(folderURL(view, folderId, search.toString()), { viewTransition: true });
  };
  const folder = trail.at(-1);
  const parent = trail.at(-2);
  return {
    back: position > 0 ? () => navigate(-1) : undefined,
    forward: position < globalThis.history.length - 1 ? () => navigate(1) : undefined,
    open: (folderId: string) => go(folderId),
    switchView: (view: ViewMode) => folder && go(folder.id, view),
    up: parent && (() => go(parent.id)),
  };
}
