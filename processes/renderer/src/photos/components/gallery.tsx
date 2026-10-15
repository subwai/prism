import { Collection } from '#photos/components/collection';
import { FolderPeek } from '#photos/components/folder-peek';
import { ImageViewer, Modal } from '#photos/components/image-viewer';
import { Toolbar } from '#photos/components/toolbar';
import type { ScanState } from '#photos/data/directory-scan';
import { arrangeEntries, type ViewMode } from '#photos/data/entries';
import type { loadGallery } from '#photos/data/route-loaders';
import { folderURL, sortOrder } from '#photos/data/urls';
import { ScanResults } from '#photos/fetchers/scan-pages';
import type { PhotoEntry } from '@app/shared';
import { Image as ImageIcon, SlidersHorizontal } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useFetcher, useNavigate, useNavigation, useSearchParams } from 'react-router';

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
    <div className="empty-state">
      <ImageIcon size={30} strokeWidth={1} />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function GalleryHeading({
  name,
  mode,
  scan,
  count,
  reload
}: {
  name: string;
  mode: ViewMode;
  scan: ScanState;
  count: number;
  reload: () => void;
}) {
  return (
    <>
      <div className="gallery-heading">
        <div>
          <h1>{name}</h1>
          <p>
            {mode === 'filmstrip'
              ? 'All photos, including subfolders'
              : 'A place for every perspective'}
          </p>
        </div>
        <span className={`scan-status ${scan.loading ? 'scanning' : ''}`} role="status">
          {scan.loading
            ? 'Reading folder…'
            : `${count.toLocaleString()} ${mode === 'filmstrip' ? 'photos' : 'items'}`}
        </span>
      </div>
      {(scan.error || scan.errors.length > 0) && (
        <div className="error-banner" role="alert">
          {scan.error ?? `${scan.errors.length} items could not be read. The rest are shown below.`}
          <button type="button" className="text-button" onClick={reload}>
            Try again
          </button>
        </div>
      )}
    </>
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
  const navigate = useNavigate();
  const navigation = useNavigation();
  const refresh = useFetcher();
  const [params, setParams] = useSearchParams();
  const directory = data.trail.at(-1) ?? data.trail[0];
  const search = params.get('q') ?? '';
  const sort = sortOrder(params);
  const descending = params.get('order') === 'desc';
  const [size, setSize] = useState(160);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PhotoEntry | null>(null);
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
    refresh.submit({ intent: 'refresh' }, { action: '/library', method: 'post' });
  }
  function open(entry: PhotoEntry) {
    if (entry.kind === 'directory') {
      navigate(folderURL(mode, entry.id, params.toString()));
    } else {
      setPreview(entry);
    }
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        reload();
      }
      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        navigate(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }
    globalThis.addEventListener('keydown', shortcut);
    return () => globalThis.removeEventListener('keydown', shortcut);
  });
  if (!directory) {
    return null;
  }
  return (
    <section className="gallery" aria-busy={navigation.state !== 'idle'}>
      <Toolbar
        trail={data.trail}
        back
        forward
        onBack={() => navigate(-1)}
        onForward={() => navigate(1)}
        onNavigate={(trail) =>
          navigate(folderURL(mode, trail.at(-1)?.id ?? directory.id, params.toString()))
        }
        onRefresh={reload}
        search={search}
        onSearch={(value) => updateQuery('q', value)}
        sort={sort}
        onSort={(value) => updateQuery('sort', value)}
        descending={descending}
        onDescending={() => updateQuery('order', descending ? 'asc' : 'desc')}
        mode={mode}
        onMode={(next) => navigate(folderURL(next, directory.id, params.toString()))}
      />
      <GalleryHeading
        name={directory.name}
        mode={mode}
        scan={scan}
        count={entries.length}
        reload={reload}
      />
      <div className={`gallery-content ${mode}`}>
        {mode === 'filmstrip' && (
          <ImageViewer
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
            size={mode === 'filmstrip' ? 110 : size}
            mode={mode}
          />
        ) : (
          <EmptyCollection loading={scan.loading} search={search} />
        )}
      </div>
      <footer className="gallery-footer">
        <span>
          {selected?.name ??
            (mode === 'grid' ? 'Space to preview · Enter to open' : 'Arrow keys to browse')}
        </span>
        <label className="size-control">
          <SlidersHorizontal size={13} />
          <input
            type="range"
            aria-label="Thumbnail size"
            min={110}
            max={240}
            step={10}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            disabled={mode === 'filmstrip'}
          />
        </label>
      </footer>
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
          <Modal label={preview.name} onClose={() => setPreview(null)}>
            <ImageViewer
              entries={images}
              selected={preview}
              onSelect={setPreview}
              onClose={() => setPreview(null)}
            />
          </Modal>
        )
      )}
    </section>
  );
}

export function Gallery({ data, mode }: { data: GalleryData; mode: ViewMode }) {
  return (
    <ScanResults scan={data.scan} initial={data.page.state}>
      {(scan) => <GalleryContents data={data} mode={mode} scan={scan} />}
    </ScanResults>
  );
}
