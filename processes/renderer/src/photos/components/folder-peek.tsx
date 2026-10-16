import { Collection } from '#photos/components/collection';
import type { FolderTrail } from '#photos/components/folder-tree';
import { PhotoPeek, useViewerState } from '#photos/components/image-viewer';
import type { ScanState } from '#photos/data/directory-scan';
import { arrangeEntries } from '#photos/data/entries';
import { useLibrary } from '#photos/hooks/use-library';
import { Banner, Button, EmptyState, IconButton, PreviewSheet } from '@app/design-system';
import type { PhotoEntry } from '@app/shared';
import { ArrowUp, ExternalLink } from 'lucide-react';
import { Suspense, use, useMemo, useState } from 'react';

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
  const scan: ScanState = use(library.directory(id));
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
            size={130}
            autoFocus
          />
        </>
      )}
      <div className="border-t border-separator px-5.5 py-2.75 text-footnote text-label-tertiary">
        {scan.loading ? 'Reading folder…' : `${entries.length.toLocaleString()} items`}
        {scan.errors.length > 0 && ` · ${scan.errors.length} could not be read`}
      </div>
      {preview && selected && (
        <PhotoPeek
          entries={entries.filter((entry) => entry.kind === 'image')}
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
  const [trail, setTrail] = useState(initialTrail);
  const library = useLibrary();
  const folder = trail.at(-1) ?? library.root;
  return (
    <PreviewSheet
      label={`Peek inside ${folder.name}`}
      title={folder.name}
      caption="Folder preview"
      size="medium"
      onClose={onClose}
      leading={
        <IconButton
          label="Up in folder preview"
          disabled={trail.length <= initialTrail.length}
          onClick={() => setTrail(trail.slice(0, -1))}
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
      <Suspense key={folder.id} fallback={<EmptyState description="Reading folder…" />}>
        <PeekContents
          id={folder.id}
          onOpen={(entry) => setTrail([...trail, entry])}
          onClose={onClose}
        />
      </Suspense>
    </PreviewSheet>
  );
}
