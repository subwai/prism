import { GalleryStatus } from '#components/gallery/gallery-status';
import { ScanProblems } from '#components/gallery/scan-problems';
import { Toolbar } from '#components/gallery/toolbar';
import { useGalleryNavigation } from '#components/gallery/use-gallery-navigation';
import { usePageWidth, useThumbnailSize } from '#components/gallery/use-thumbnail-size';
import { Preview } from '#components/preview/preview';
import type { ScanState } from '#data/directory-scan';
import { arrangeView, isMedia, VIEW_MODES, type ViewMode } from '#data/entries';
import { narrows } from '#data/filters';
import type { loadGallery } from '#data/route-loaders';
import { useViewParams } from '#hooks/use-view-params';
import { useGlobalCommands } from '#keyboard/commands';
import { EmptyState } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { Image as ImageIcon } from 'lucide-react';
import { type ReactNode, useDeferredValue, useMemo, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigation, useSubmit } from 'react-router';

export type GalleryData = Awaited<ReturnType<typeof loadGallery>>;

/** The view's scan as it streams in, after the first page its loader read. */
export function useScan(data: GalleryData) {
  return useSyncExternalStore(data.scan.subscribe, data.scan.getSnapshot);
}

/**
 * What the view shows of its scan, in order, as the URL's search and sort say: all `entries`,
 * and the photos and videos among them, `media`. Typing and new pages update it in the
 * background, so neither holds up the keys.
 */
export function useArrangedEntries(scan: ScanState, mode: ViewMode) {
  const { search, sort, descending, filter } = useViewParams();
  const deferredEntries = useDeferredValue(scan.entries);
  const deferredSearch = useDeferredValue(search);
  const camera = filter?.camera,
    lens = filter?.lens,
    tag = filter?.tag;
  const entries = useMemo(
    () =>
      arrangeView(deferredEntries, mode, {
        descending,
        filter:
          camera === undefined || lens === undefined || tag === undefined
            ? null
            : { camera, lens, tag },
        search: deferredSearch,
        sort,
      }),
    [deferredEntries, deferredSearch, sort, descending, mode, camera, lens, tag],
  );
  const media = useMemo(() => entries.filter((entry) => isMedia(entry)), [entries]);
  return { entries, media };
}

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
  scan,
  count,
  selected,
  media,
  children,
}: {
  data: GalleryData;
  mode: ViewMode;
  scan: ScanState;
  /** How many entries the view shows. */
  count: number;
  selected: PhotoEntry | null;
  /** The photos and videos a photo preview browses. */
  media: PhotoEntry[];
  children: ReactNode;
}) {
  const submit = useSubmit();
  const location = useLocation();
  const pending = useNavigation().state !== 'idle';
  const navigation = useGalleryNavigation(mode, data.trail);
  const thumbnailSize = useThumbnailSize();
  const pageWidth = usePageWidth();
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
        entries={scan.entries}
        refreshes={refreshes}
        onRefresh={refresh}
      />
      <ScanProblems scan={scan} scanKey={data.scan} onRetry={refresh} />
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
      <GalleryStatus
        pending={pending}
        mode={mode}
        scan={scan}
        count={count}
        selected={selected}
        size={size}
        onSize={setSize}
      />
      {mode === 'grid' && (
        <Preview
          media={media}
          folderId={folder.id}
          onOpenFolder={(folderId) => navigation.open(folderId)}
        />
      )}
    </main>
  );
}
