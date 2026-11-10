import { GalleryStatus } from '#components/gallery/gallery-status';
import { ScanProblems } from '#components/gallery/scan-problems';
import { Toolbar } from '#components/gallery/toolbar';
import { useGalleryNavigation } from '#components/gallery/use-gallery-navigation';
import { Preview } from '#components/preview/preview';
import { VIEW_MODES, type ViewMode } from '#data/entries';
import { narrows } from '#data/filters';
import { useLayoutPreference } from '#data/layout-preferences';
import type { GalleryData } from '#data/route-loaders';
import { useViewState } from '#hooks/use-gallery-view';
import { useViewParams } from '#hooks/use-view-params';
import { useGlobalCommands } from '#keyboard/commands';
import { EmptyState } from '@prism/design-system';
import { needsDetails, type PhotoEntry } from '@prism/shared';
import { Image as ImageIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useLocation, useNavigation, useSubmit } from 'react-router';

export type { GalleryData } from '#data/route-loaders';

/** What the view says when it has nothing to show. */
export function EmptyCollection({ loading }: { loading: boolean }) {
  const { search, filter } = useViewParams();
  let title = 'A quiet corner',
    description = 'No photos or folders to show here.';
  if (loading) {
    title = 'Looking around…';
    description = 'Photos will appear as they are found.';
  } else if (search) {
    title = 'No matches';
    description = 'Try a different search.';
  } else if (narrows(filter)) {
    title = 'No matches';
    description = 'No photos here match the filters.';
  }
  return (
    <EmptyState
      icon={<ImageIcon size={30} strokeWidth={1} />}
      title={title}
      description={description}
    />
  );
}

/**
 * What the grid, the filmstrip and the reader share around their own contents: the toolbar, problems
 * reading the folder, the status bar, in the grid the preview the URL names, and the window's
 * commands for moving around and refreshing. The filmstrip and the reader show photos large
 * already, so they have no preview.
 */
export function GalleryFrame({
  data,
  mode,
  selected,
  children,
}: {
  data: GalleryData;
  mode: ViewMode;
  selected: PhotoEntry | null;
  children: ReactNode;
}) {
  const state = useViewState(data.view);
  const submit = useSubmit();
  const location = useLocation();
  const pending = useNavigation().state !== 'idle';
  const navigation = useGalleryNavigation(mode, data.trail);
  const thumbnailSize = useLayoutPreference('thumbnailSize');
  const pageWidth = useLayoutPreference('pageWidth');
  const [size, setSize] = mode === 'reader' ? pageWidth : thumbnailSize;
  const [refreshes, setRefreshes] = useState(0);
  const folder = data.trail.at(-1) ?? data.trail[0];
  function refresh() {
    setRefreshes((previous) => previous + 1);
    submit(
      { intent: 'refresh', returnTo: location.pathname + location.search },
      { action: '/library', method: 'post', replace: true, viewTransition: true },
    );
  }
  useGlobalCommands({
    back: navigation.back,
    forward: navigation.forward,
    refresh,
    toggleView: () =>
      navigation.switchView(
        VIEW_MODES[(VIEW_MODES.indexOf(mode) + 1) % VIEW_MODES.length] ?? 'grid',
      ),
    up: navigation.up,
  });
  if (!folder) {
    return null;
  }
  return (
    <main
      // No dimming while the next folder loads: the current one stays until it is ready.
      className="bg-content-fade flex min-w-0 flex-1 flex-col aria-busy:cursor-progress"
      aria-busy={pending}
    >
      {/* The breadcrumbs show where this is; the heading lets screen readers jump to it. */}
      <h1 className="sr-only">{folder.name}</h1>
      <Toolbar
        trail={data.trail}
        mode={mode}
        view={data.view}
        refreshes={refreshes}
        onRefresh={refresh}
      />
      <ScanProblems
        scan={state}
        scanKey={data.view}
        errors={data.view.errorsQuery(state.version)}
        onRetry={refresh}
      />
      <div className="group-data-waited/gallery:animate-fade-in relative flex min-h-0 flex-1 flex-col">
        {children}
      </div>
      <GalleryStatus
        pending={pending}
        mode={mode}
        state={state}
        details={needsDetails(data.view.spec)}
        selected={selected}
        size={size}
        onSize={setSize}
      />
      {mode === 'grid' && (
        <Preview
          spec={data.view.spec}
          folderId={folder.id}
          onOpenFolder={(folderId) => navigation.open(folderId)}
        />
      )}
    </main>
  );
}
