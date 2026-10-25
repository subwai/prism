import { useGlobalCommands } from '#keyboard/commands';
import { Collection } from '#photos/components/collection';
import {
  EmptyCollection,
  type GalleryData,
  GalleryFrame,
  useArrangedEntries,
  useScan
} from '#photos/components/gallery-frame';
import { ImageViewer } from '#photos/components/image-viewer';
import { THUMBNAIL_SIZE } from '#photos/data/entries';
import { useLibrary } from '#photos/hooks/use-library';
import { useViewParams } from '#photos/hooks/use-view-params';
import { useState } from 'react';

/**
 * Every photo and video in a folder and the folders inside it, one at a time in the viewer
 * above a strip of them all. The viewer shows the selection, the first until one is chosen.
 */
export function FilmstripView({ data }: { data: GalleryData }) {
  const library = useLibrary();
  const scan = useScan(data);
  const { entries } = useArrangedEntries(scan, 'filmstrip');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    (selectedId !== null && library.locate(entries, selectedId)) || (entries[0] ?? null);
  const { preview, slideshow, openPreview, setSlideshow } = useViewParams();
  useGlobalCommands({ slideshow: () => setSlideshow(!slideshow) });
  return (
    <GalleryFrame
      data={data}
      mode="filmstrip"
      scan={scan}
      count={entries.length}
      selected={selected}
      media={entries}
    >
      <ImageViewer
        entries={entries}
        selected={selected}
        onSelect={(entry) => setSelectedId(entry.id)}
        // A preview sheet over it has the keys, and the only sound.
        active={preview === null}
      />
      {entries.length > 0 ? (
        <Collection
          entries={entries}
          selectedId={selected?.id ?? null}
          onSelect={(entry) => setSelectedId(entry.id)}
          onOpen={(entry) => openPreview(entry.id)}
          onPreview={(entry) => openPreview(entry.id)}
          size={THUMBNAIL_SIZE.filmstrip}
          mode="filmstrip"
        />
      ) : (
        <EmptyCollection loading={scan.loading} />
      )}
    </GalleryFrame>
  );
}
