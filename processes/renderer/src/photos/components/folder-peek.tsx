import { Collection } from '#photos/components/collection';
import type { FolderTrail } from '#photos/components/folder-tree';
import { ImageViewer, Modal } from '#photos/components/image-viewer';
import type { ScanState } from '#photos/data/directory-scan';
import { arrangeEntries } from '#photos/data/entries';
import { resourceURL } from '#photos/data/urls';
import { useLibrary } from '#photos/hooks/use-library';
import type { clientLoader } from '#routes/resources+/directory';
import type { PhotoEntry } from '@app/shared';
import { ArrowUp, ExternalLink, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFetcher } from 'react-router';

function PeekContents({ scan, onOpen }: { scan: ScanState; onOpen: (entry: PhotoEntry) => void }) {
  const [selected, setSelected] = useState<PhotoEntry | null>(null);
  const [preview, setPreview] = useState(false);
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
      {scan.error && (
        <p className="error-banner" role="alert">
          {scan.error}
        </p>
      )}
      {!scan.loading && entries.length === 0 ? (
        <div className="empty-state">
          <p>No photos or folders here</p>
        </div>
      ) : (
        <Collection
          entries={entries}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          onOpen={open}
          onPreview={open}
          size={130}
        />
      )}
      <div className="peek-footer">
        {scan.loading ? 'Reading folder…' : `${entries.length.toLocaleString()} items`}
        {scan.errors.length > 0 && ` · ${scan.errors.length} could not be read`}
      </div>
      {preview && selected && (
        <Modal label={selected.name} onClose={() => setPreview(false)}>
          <ImageViewer
            entries={entries.filter((entry) => entry.kind === 'image')}
            selected={selected}
            onSelect={setSelected}
            onClose={() => setPreview(false)}
          />
        </Modal>
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
  const directory = useFetcher<typeof clientLoader>();
  const { reset } = directory;
  useEffect(() => () => reset(), [reset]);
  useEffect(() => {
    if (directory.data?.id !== folder.id && directory.state === 'idle') {
      directory.load(resourceURL('directory', { id: folder.id }));
    }
  }, [directory, folder.id]);
  const state = directory.data?.id === folder.id ? directory.data.state : null;
  return (
    <Modal label={`Peek inside ${folder.name}`} onClose={onClose} className="folder-peek">
      <header className="peek-heading">
        <button
          type="button"
          className="icon-button"
          aria-label="Up in folder preview"
          disabled={trail.length <= initialTrail.length}
          onClick={() => setTrail(trail.slice(0, -1))}
        >
          <ArrowUp size={16} />
        </button>
        <div>
          <strong>{folder.name}</strong>
          <span>FOLDER PREVIEW</span>
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            onNavigate(trail);
            onClose();
          }}
        >
          Open folder <ExternalLink size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Close folder preview"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {state ? (
        <PeekContents
          key={folder.id}
          scan={state}
          onOpen={(entry) => setTrail([...trail, entry])}
        />
      ) : (
        <div className="empty-state">
          <p>Reading folder…</p>
        </div>
      )}
    </Modal>
  );
}
