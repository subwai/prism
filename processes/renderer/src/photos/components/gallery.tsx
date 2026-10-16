import { Collection } from '#photos/components/collection';
import { FolderPeek } from '#photos/components/folder-peek';
import { ImageViewer, PhotoPeek, useViewerState } from '#photos/components/image-viewer';
import { Toolbar } from '#photos/components/toolbar';
import type { ScanState } from '#photos/data/directory-scan';
import { arrangeEntries, THUMBNAIL_SIZE, type ViewMode } from '#photos/data/entries';
import type { loadGallery } from '#photos/data/route-loaders';
import { folderURL, sortOrder } from '#photos/data/urls';
import { useCommand } from '#photos/hooks/use-command';
import { useHistoryEnds } from '#photos/hooks/use-history-ends';
import { useShiftKey } from '#photos/hooks/use-shift-key';
import { isShiftKey } from '#photos/shortcuts';
import { Banner, Button, EmptyState, Slider, StatusBar, StatusIndicator } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { Image as ImageIcon, SlidersHorizontal } from 'lucide-react';
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate, useNavigation, useSearchParams, useSubmit } from 'react-router';

type GalleryData = Awaited<ReturnType<typeof loadGallery>>;

function EmptyCollection({ loading, search }: { loading: boolean; search: string }) {
  let title = 'A quiet corner',
    description = 'No photos or folders to show here.';
  if (loading) {
    title = 'Looking around…';
    description = 'Photos will appear as they are found.';
  } else if (search) {
    title = 'No matches';
    description = 'Try a different search.';
  }
  return (
    <EmptyState
      icon={<ImageIcon size={30} strokeWidth={1} />}
      title={title}
      description={description}
    />
  );
}

function ScanProblems({ scan, reload }: { scan: ScanState; reload: () => void }) {
  if (!scan.error && scan.errors.length === 0) {
    return null;
  }
  return (
    <Banner action={<Button onClick={reload}>Try again</Button>}>
      {scan.error ?? `${scan.errors.length} items could not be read. The rest are shown below.`}
    </Banner>
  );
}

function GalleryStatus({
  mode,
  pending,
  scan,
  count,
  selected,
  size,
  onSize
}: {
  mode: ViewMode;
  /** A navigation or refresh is loading the next view. */
  pending: boolean;
  scan: ScanState;
  count: number;
  selected: PhotoEntry | null;
  size: number;
  onSize: (size: number) => void;
}) {
  let status = `${count.toLocaleString()} ${mode === 'filmstrip' ? 'photos' : 'items'}`;
  if (pending) {
    status = 'Loading…';
  } else if (scan.loading) {
    status = 'Reading folder…';
  }
  let hint = 'Arrow keys to browse';
  if (mode === 'grid') {
    hint = 'Space to preview · Enter to open';
  }
  return (
    <StatusBar>
      <span className="truncate">{selected?.name ?? hint}</span>
      <span className="ml-auto">
        <StatusIndicator busy={pending || scan.loading}>{status}</StatusIndicator>
      </span>
      {mode === 'grid' && (
        <Slider
          label="Thumbnail size"
          icon={<SlidersHorizontal size={13} />}
          min={110}
          max={240}
          step={10}
          value={size}
          onChange={onSize}
        />
      )}
    </StatusBar>
  );
}

function GalleryContents({
  data,
  mode,
  scan
}: {
  data: GalleryData;
  mode: ViewMode;
  scan: ScanState;
}) {
  const router = useNavigate();
  // Crossfade at commit, once the next view is ready; history steps replay it automatically.
  const navigate = (to: string | number) =>
    typeof to === 'number' ? router(to) : router(to, { viewTransition: true });
  const submit = useSubmit();
  const location = useLocation();
  const navigation = useNavigation();
  const [params, setParams] = useSearchParams();
  const directory = data.trail.at(-1) ?? data.trail[0];
  const search = params.get('q') ?? '';
  const sort = sortOrder(params);
  const descending = params.get('order') === 'desc';
  const [size, setSize] = useState(THUMBNAIL_SIZE.grid);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PhotoEntry | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  // Shared by the filmstrip's viewer and the preview sheet.
  const viewer = useViewerState();
  const deferredEntries = useDeferredValue(scan.entries);
  const deferredSearch = useDeferredValue(search);
  const entries = useMemo(
    () => arrangeEntries(deferredEntries, deferredSearch, sort, descending, mode === 'filmstrip'),
    [deferredEntries, deferredSearch, sort, descending, mode]
  );
  const images = useMemo(() => entries.filter((entry) => entry.kind === 'image'), [entries]);
  const selected =
    entries.find((entry) => entry.id === selectedId) ??
    (mode === 'filmstrip' ? (entries[0] ?? null) : null);
  function updateQuery(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        return next;
      },
      { preventScrollReset: true, replace: true }
    );
  }
  function reload() {
    setRefreshes((count) => count + 1);
    submit(
      { intent: 'refresh', returnTo: location.pathname + location.search },
      { action: '/library', method: 'post', replace: true, viewTransition: true }
    );
  }
  function open(entry: PhotoEntry) {
    if (entry.kind === 'directory') {
      navigate(folderURL(mode, entry.id, params.toString()));
    } else {
      setPreview(entry);
    }
  }
  function closePreview() {
    setPreview(null);
    viewer.onPlayingChange(false);
  }
  useCommand('refresh', reload);
  // Toggles a running slideshow; otherwise opens the selected (or first) photo and starts one.
  function toggleSlideshow() {
    if (mode === 'filmstrip' || preview?.kind === 'image') {
      viewer.onPlayingChange(!viewer.playing);
      return;
    }
    const start = selected?.kind === 'image' ? selected : images[0];
    if (start) {
      setPreview(start);
      viewer.onPlayingChange(true);
    }
  }
  useCommand('slideshow', toggleSlideshow);
  useShiftKey('S', toggleSlideshow);
  const can = useHistoryEnds();
  useCommand('back', () => can.back && navigate(-1));
  useCommand('forward', () => can.forward && navigate(1));
  useCommand('up', () => {
    const parent = data.trail.at(-2);
    if (parent) {
      navigate(folderURL(mode, parent.id, params.toString()));
    }
  });
  if (!directory) {
    return null;
  }
  return (
    <section
      // No dimming while the next folder loads: the current one stays until it is ready.
      className="bg-content-fade flex min-w-0 flex-1 flex-col aria-busy:cursor-progress"
      aria-busy={navigation.state !== 'idle'}
      // Viewers handle this themselves; this covers the filmstrip while its strip has focus.
      onKeyDown={(event) => {
        if (isShiftKey(event, 'F')) {
          event.preventDefault();
          viewer.onFitChange(!viewer.fit);
        }
      }}
    >
      <Toolbar
        trail={data.trail}
        back={can.back}
        forward={can.forward}
        onBack={() => navigate(-1)}
        onForward={() => navigate(1)}
        onNavigate={(trail) =>
          navigate(folderURL(mode, trail.at(-1)?.id ?? directory.id, params.toString()))
        }
        onRefresh={reload}
        refreshes={refreshes}
        search={search}
        onSearch={(value) => updateQuery('q', value)}
        sort={sort}
        onSort={(value) => updateQuery('sort', value)}
        descending={descending}
        onDescending={() => updateQuery('order', descending ? 'asc' : 'desc')}
        mode={mode}
        onMode={(next) => navigate(folderURL(next, directory.id, params.toString()))}
      />
      <ScanProblems scan={scan} reload={reload} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {mode === 'filmstrip' && (
          <ImageViewer
            viewer={viewer}
            entries={images}
            selected={selected}
            onSelect={(entry) => setSelectedId(entry.id)}
          />
        )}
        {entries.length > 0 ? (
          <Collection
            entries={entries}
            selectedId={selected?.id ?? null}
            onSelect={(entry) => setSelectedId(entry.id)}
            onOpen={open}
            onPreview={setPreview}
            size={mode === 'filmstrip' ? THUMBNAIL_SIZE.filmstrip : size}
            mode={mode}
          />
        ) : (
          <EmptyCollection loading={scan.loading} search={search} />
        )}
      </div>
      <GalleryStatus
        pending={navigation.state !== 'idle'}
        mode={mode}
        scan={scan}
        count={entries.length}
        selected={selected}
        size={size}
        onSize={setSize}
      />
      {preview?.kind === 'directory' ? (
        <FolderPeek
          initialTrail={[...data.trail, preview]}
          onClose={() => setPreview(null)}
          onNavigate={(trail) =>
            navigate(folderURL(mode, trail.at(-1)?.id ?? directory.id, params.toString()))
          }
        />
      ) : (
        preview && (
          <PhotoPeek
            viewer={viewer}
            entries={images}
            selected={preview}
            onSelect={setPreview}
            onClose={closePreview}
          />
        )
      )}
    </section>
  );
}

export function Gallery({ data, mode }: { data: GalleryData; mode: ViewMode }) {
  // The loader read the first page; later pages stream into the scan as they arrive.
  const scan = useSyncExternalStore(data.scan.subscribe, data.scan.getSnapshot);
  return <GalleryContents data={data} mode={mode} scan={scan} />;
}
