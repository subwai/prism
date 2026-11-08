import { Collection } from '#components/collection';
import { EmptyCollection, type GalleryData, GalleryFrame } from '#components/gallery/gallery-frame';
import { ImageViewer } from '#components/viewer/image-viewer';
import { THUMBNAIL_SIZE } from '#data/entries';
import { useBrowsing, useViewEntries, useViewEntry, useViewState } from '#hooks/use-gallery-view';
import { useViewParams } from '#hooks/use-view-params';
import { useGlobalCommands } from '#keyboard/commands';
import type { PhotoEntry } from '@prism/shared';
import { useState } from 'react';

/**
 * Every photo and video in a folder and the folders inside it, one at a time in the viewer
 * above a strip of them all. The viewer shows the selection, the first until one is chosen.
 */
export function FilmstripView({ data }: { data: GalleryData }) {
  const { view } = data;
  const state = useViewState(view);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chosen = useViewEntry(view, selectedId).entry;
  const first = useViewEntries(view, 0, 1)(0);
  const selected = (selectedId === null ? first : chosen) ?? null;
  const select = (entry: PhotoEntry) => setSelectedId(entry.id);
  const browsing = useBrowsing(view, selected, select);
  const { slideshow, setSlideshow } = useViewParams();
  useGlobalCommands({ slideshow: () => setSlideshow(!slideshow) });
  return (
    <GalleryFrame data={data} mode="filmstrip" selected={selected}>
      <ImageViewer browsing={browsing} selected={selected} active />
      {state.count > 0 ? (
        <Collection
          view={view}
          selectedId={selected?.id ?? null}
          onSelect={select}
          size={THUMBNAIL_SIZE.filmstrip}
          mode="filmstrip"
        />
      ) : (
        <EmptyCollection loading={state.loading} />
      )}
    </GalleryFrame>
  );
}
