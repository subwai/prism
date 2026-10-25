import { Collection } from '#components/collection';
import { PhotoPeek } from '#components/preview/photo-peek';
import { arrangeEntries, isMedia } from '#data/entries';
import { folderPreviewQuery, PREVIEW_TILE } from '#data/folder-preview';
import { useLibrary } from '#hooks/use-library';
import { useCommands } from '#keyboard/commands';
import { useShortcut } from '#keyboard/shortcuts';
import { Banner, Button, EmptyState, IconButton, PreviewSheet } from '@prism/design-system';
import type { PhotoEntry, PhotoFolder } from '@prism/shared';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ArrowUp, ExternalLink } from 'lucide-react';
import { Suspense, useDeferredValue, useMemo, useState, ViewTransition } from 'react';

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
  // Opens with its first screen of thumbnails decoded, then follows changes to the folder.
  useSuspenseQuery(folderPreviewQuery(library, id));
  const { data: scan } = useSuspenseQuery(library.directoryQuery(id));
  const [selected, setSelected] = useState<PhotoEntry | null>(null);
  // A photo opens in a sheet of its own, over this one, until closed.
  const [previewing, setPreviewing] = useState(false);
  const entries = useMemo(() => arrangeEntries(scan.entries, '', 'name', false), [scan.entries]);
  function open(entry: PhotoEntry) {
    if (entry.kind === 'directory') {
      onOpen(entry);
    } else {
      setSelected(entry);
      setPreviewing(true);
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
      <div className="border-separator text-label-tertiary border-t px-5.5 py-2.75 text-sm">
        {scan.loading ? 'Reading folder…' : `${entries.length.toLocaleString()} items`}
        {scan.errors.length > 0 && ` · ${scan.errors.length} could not be read`}
      </div>
      {previewing && selected && (
        <PhotoPeek
          entries={entries.filter((entry) => isMedia(entry))}
          selected={selected}
          onSelect={setSelected}
          onClose={() => setPreviewing(false)}
        />
      )}
    </>
  );
}

/**
 * A folder in a preview sheet. Moving to another folder keeps this one on screen until the
 * next is ready to show whole, then crossfades, as the gallery does.
 */
export function FolderPeek({
  folder: requested,
  canGoUp,
  onMove,
  onOpen,
  onClose
}: {
  folder: PhotoFolder;
  /** Whether "Up" leads anywhere new: not to the folder the gallery already shows. */
  canGoUp: boolean;
  /** Shows another folder in the sheet: one inside this, or its parent. */
  onMove: (folderId: string) => void;
  /** Opens the folder in the gallery. */
  onOpen: (folderId: string) => void;
  onClose: () => void;
}) {
  const shortcut = useShortcut();
  const library = useLibrary();
  const commands = useCommands({ preview: onClose });
  // The folder on screen stays until the requested one can show whole.
  const folder = useDeferredValue(requested);
  const parent = library.trail(folder.id)?.at(-2);
  return (
    <PreviewSheet
      ref={commands}
      title={folder.name}
      caption="Folder preview"
      size="medium"
      onClose={onClose}
      closeShortcut={shortcut('preview')}
      leading={
        <IconButton
          label="Up in folder preview"
          disabled={!canGoUp || !parent}
          onClick={() => parent && onMove(parent.id)}
        >
          <ArrowUp />
        </IconButton>
      }
      actions={
        <Button onClick={() => onOpen(folder.id)}>
          Open folder <ExternalLink />
        </Button>
      }
    >
      <ViewTransition>
        <div className="flex min-h-0 flex-1 flex-col">
          {/* One boundary for every folder, so a move holds the shown one rather than falling
              back; keyed contents start each folder with nothing selected. */}
          <Suspense fallback={<EmptyState description="Reading folder…" />}>
            <PeekContents
              key={folder.id}
              id={folder.id}
              onOpen={(entry) => onMove(entry.id)}
              onClose={onClose}
            />
          </Suspense>
        </div>
      </ViewTransition>
    </PreviewSheet>
  );
}
