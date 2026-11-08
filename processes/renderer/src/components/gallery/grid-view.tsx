import { Collection } from '#components/collection';
import { EmptyCollection, type GalleryData, GalleryFrame } from '#components/gallery/gallery-frame';
import { useGalleryNavigation } from '#components/gallery/use-gallery-navigation';
import { useThumbnailSize } from '#components/gallery/use-thumbnail-size';
import { isMedia } from '#data/entries';
import { mediaOf } from '#data/urls';
import { useViewEntry, useViewState } from '#hooks/use-gallery-view';
import { useLibrary } from '#hooks/use-library';
import { useViewParams } from '#hooks/use-view-params';
import { useGlobalCommands } from '#keyboard/commands';
import type { PhotoEntry } from '@prism/shared';
import { useState } from 'react';

/**
 * A folder's photos, videos and subfolders as a grid. Photos and folders open as previews, and
 * so do folders' covers.
 */
export function GridView({ data }: { data: GalleryData }) {
  const library = useLibrary();
  const { view } = data;
  const state = useViewState(view);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useViewEntry(view, selectedId).entry ?? null;
  const [size] = useThumbnailSize();
  const navigation = useGalleryNavigation('grid', data.trail);
  const { preview, cover, slideshow, openPreview, setSlideshow } = useViewParams();
  // The cover its tile shows: the first that has a thumbnail. Nothing until it has been read.
  function previewCover(folder: PhotoEntry) {
    const covers = library.peekSummary(folder.id)?.covers ?? [];
    const first =
      covers.find((entry) => library.peekThumbnail(entry.id)?.status === 'ready') ?? covers[0];
    if (first) {
      openPreview(first.id, { coverOf: folder.id });
    }
  }
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
      if (preview !== null && cover === null && !library.trail(preview)) {
        setSlideshow(!slideshow);
        return;
      }
      const start =
        selected && isMedia(selected)
          ? Promise.resolve(selected)
          : library.view(mediaOf(view.spec)).then((media) => media.entry(0));
      start.then((entry) => entry && openPreview(entry.id, { play: true })).catch(() => null);
    },
  });
  return (
    <GalleryFrame data={data} mode="grid" selected={selected}>
      {state.count > 0 ? (
        <Collection
          view={view}
          selectedId={selectedId}
          onSelect={(entry) => setSelectedId(entry.id)}
          onOpen={open}
          onPreview={(entry) => openPreview(entry.id)}
          onPreviewCover={previewCover}
          size={size}
        />
      ) : (
        <EmptyCollection loading={state.loading} />
      )}
    </GalleryFrame>
  );
}
