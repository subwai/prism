import { Collection } from '#components/collection';
import { EmptyCollection, type GalleryData, GalleryFrame } from '#components/gallery/gallery-frame';
import { useFilmstripSize } from '#components/gallery/use-thumbnail-size';
import { ImageViewer } from '#components/viewer/image-viewer';
import { FILMSTRIP_MAX_SIZE, THUMBNAIL_SIZE } from '#data/entries';
import { useBrowsing, useViewEntries, useViewEntry, useViewState } from '#hooks/use-gallery-view';
import { useViewParams } from '#hooks/use-view-params';
import { useGlobalCommands } from '#keyboard/commands';
import { ResizeHandle } from '@prism/design-system';
import type { PhotoEntry } from '@prism/shared';
import { useId, useState } from 'react';

/** How much taller the strip is than its thumbnails: its border, top padding and scrollbar. */
const STRIP_CHROME = 20;

/**
 * Every photo and video in a folder and the folders inside it, one at a time in the viewer
 * above a strip of them all. The viewer shows the selection, the first until one is chosen.
 * Dragging the strip's top edge grows its thumbnails, and the viewer gives up the room.
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
  const stripId = useId();
  const [size, setSize] = useFilmstripSize();
  const resize = (next: number) => {
    const clamped = Math.min(Math.max(next, THUMBNAIL_SIZE.filmstrip), FILMSTRIP_MAX_SIZE);
    setSize(Math.round(clamped));
  };
  useGlobalCommands({ slideshow: () => setSlideshow(!slideshow) });
  return (
    <GalleryFrame data={data} mode="filmstrip" selected={selected}>
      <ImageViewer browsing={browsing} selected={selected} active />
      {state.count > 0 ? (
        <div
          id={stripId}
          className="border-separator relative flex flex-none flex-col border-t"
          style={{ height: size + STRIP_CHROME }}
        >
          <ResizeHandle
            edge="top"
            label="Resize filmstrip"
            controls={stripId}
            value={size}
            min={THUMBNAIL_SIZE.filmstrip}
            max={FILMSTRIP_MAX_SIZE}
            onResize={resize}
            onReset={() => setSize(THUMBNAIL_SIZE.filmstrip)}
          />
          <Collection
            view={view}
            selectedId={selected?.id ?? null}
            onSelect={select}
            size={size}
            mode="filmstrip"
          />
        </div>
      ) : (
        <EmptyCollection loading={state.loading} />
      )}
    </GalleryFrame>
  );
}
