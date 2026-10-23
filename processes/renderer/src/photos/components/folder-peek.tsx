import { Collection } from '#photos/components/collection';
import type { FolderTrail } from '#photos/components/folder-tree';
import { useViewerState } from '#photos/components/image-viewer';
import { PhotoPeek } from '#photos/components/photo-peek';
import type { ScanState } from '#photos/data/directory-scan';
import { arrangeEntries, isMedia } from '#photos/data/entries';
import { PREVIEW_TILE, readFolderPreview } from '#photos/data/folder-preview';
import { useLibrary } from '#photos/hooks/use-library';
import { useShortcutLabel } from '#photos/shortcuts';
import { Banner, Button, EmptyState, IconButton, PreviewSheet } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { ArrowUp, ExternalLink } from 'lucide-react';
import {
  Suspense,
  use,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  ViewTransition
} from 'react';

function PeekContents({
  id,
  onOpen,
  onClose
}: {
  id: string;
  onOpen: (entry: PhotoEntry) => void;
  onClose: () => void;
}) {
  const library = useLibrary();
  // Re-render as the folder is read again after a change, showing its old listing meanwhile.
  useSyncExternalStore(library.subscribe, library.getVersion);
  const opened = use(readFolderPreview(library, id));
  const scan: ScanState = library.peekDirectory(id)?.value ?? opened;
  const [selected, setSelected] = useState<PhotoEntry | null>(null);
  const [preview, setPreview] = useState(false);
  const viewer = useViewerState();
  const entries = useMemo(() => arrangeEntries(scan.entries, '', 'name', false), [scan.entries]);
  function open(entry: PhotoEntry) {
    if (entry.kind === 'directory') {
      onOpen(entry);
    } else {
      setSelected(entry);
      setPreview(true);
    }
  }
  return (
    <>
      {scan.error && <Banner>{scan.error}</Banner>}
      {!scan.loading && entries.length === 0 ? (
        <EmptyState description="No photos or folders here" />
      ) : (
        <>
          <div className="h-4 shrink-0" />
          <Collection
            entries={entries}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            onOpen={open}
            onPreview={onClose}
            size={PREVIEW_TILE}
            autoFocus
          />
        </>
      )}
      <div className="border-separator text-footnote text-label-tertiary border-t px-5.5 py-2.75">
        {scan.loading ? 'Reading folder…' : `${entries.length.toLocaleString()} items`}
        {scan.errors.length > 0 && ` · ${scan.errors.length} could not be read`}
      </div>
      {preview && selected && (
        <PhotoPeek
          entries={entries.filter((entry) => isMedia(entry))}
          selected={selected}
          onSelect={setSelected}
          onClose={() => setPreview(false)}
          viewer={viewer}
        />
      )}
    </>
  );
}

export function FolderPeek({
  initialTrail,
  onClose,
  onNavigate
}: {
  initialTrail: FolderTrail;
  onClose: () => void;
  onNavigate: (trail: FolderTrail) => void;
}) {
  const label = useShortcutLabel();
  const [trail, setTrail] = useState(initialTrail);
  // Moving to another folder keeps this one on screen until the next is ready to show whole,
  // then crossfades, as the gallery does.
  const [moving, startMoving] = useTransition();
  const move = (next: FolderTrail) => startMoving(() => setTrail(next));
  const library = useLibrary();
  const folder = trail.at(-1) ?? library.root;
  return (
    <PreviewSheet
      label={`Peek inside ${folder.name}`}
      title={folder.name}
      caption="Folder preview"
      size="medium"
      onClose={onClose}
      closeShortcut={label('preview')}
      leading={
        <IconButton
          label="Up in folder preview"
          disabled={trail.length <= initialTrail.length}
          onClick={() => move(trail.slice(0, -1))}
        >
          <ArrowUp size={16} />
        </IconButton>
      }
      actions={
        <Button
          onClick={() => {
            onNavigate(trail);
            onClose();
          }}
        >
          Open folder <ExternalLink size={13} />
        </Button>
      }
    >
      <ViewTransition>
        <div className="flex min-h-0 flex-1 flex-col aria-busy:cursor-progress" aria-busy={moving}>
          {/* One boundary for every folder, so a move holds the shown one rather than falling
              back; keyed contents start each folder with nothing selected. */}
          <Suspense fallback={<EmptyState description="Reading folder…" />}>
            <PeekContents
              key={folder.id}
              id={folder.id}
              onOpen={(entry) => move([...trail, entry])}
              onClose={onClose}
            />
          </Suspense>
        </div>
      </ViewTransition>
    </PreviewSheet>
  );
}
