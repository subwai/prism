import { useGlobalCommands } from '#keyboard/commands';
import { Collection } from '#photos/components/collection';
import {
  EmptyCollection,
  type GalleryData,
  GalleryFrame,
  useArrangedEntries,
  useScan
} from '#photos/components/gallery-frame';
import { isMedia } from '#photos/data/entries';
import { useGalleryNavigation } from '#photos/hooks/use-gallery-navigation';
import { useLibrary } from '#photos/hooks/use-library';
import { useThumbnailSize } from '#photos/hooks/use-thumbnail-size';
import { useViewParams } from '#photos/hooks/use-view-params';
import type { PhotoEntry } from '@prism/shared';
import { useState } from 'react';

/** A folder's photos, videos and subfolders as a grid. Photos and folders open as previews. */
export function GridView({ data }: { data: GalleryData }) {
  const library = useLibrary();
  const scan = useScan(data);
  const { entries, media } = useArrangedEntries(scan, 'grid');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = (selectedId !== null && library.locate(entries, selectedId)) || null;
  const [size] = useThumbnailSize();
  const navigation = useGalleryNavigation('grid', data.trail);
  const { preview, slideshow, openPreview, setSlideshow } = useViewParams();
  function open(entry: PhotoEntry) {
    if (entry.kind === 'directory') {
      navigation.open(entry.id);
    } else {
      openPreview(entry.id);
    }
  }
  useGlobalCommands({
    // Toggles the slideshow of a photo being previewed; otherwise previews the selected (or
    // first) photo and starts one.
    slideshow() {
      if (preview !== null && library.locate(media, preview)) {
        setSlideshow(!slideshow);
        return;
      }
      const start = selected && isMedia(selected) ? selected : media[0];
      if (start) {
        openPreview(start.id, { play: true });
      }
    }
  });
  return (
    <GalleryFrame
      data={data}
      mode="grid"
      scan={scan}
      count={entries.length}
      selected={selected}
      media={media}
    >
      {entries.length > 0 ? (
        <Collection
          entries={entries}
          selectedId={selected?.id ?? null}
          onSelect={(entry) => setSelectedId(entry.id)}
          onOpen={open}
          onPreview={(entry) => openPreview(entry.id)}
          size={size}
        />
      ) : (
        <EmptyCollection loading={scan.loading} />
      )}
    </GalleryFrame>
  );
}
