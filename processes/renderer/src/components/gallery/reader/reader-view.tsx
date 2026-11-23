import { EmptyCollection, type GalleryData, GalleryFrame } from '#components/gallery/gallery-frame';
import { Pages } from '#components/gallery/reader/pages';
import { useLayoutPreference } from '#data/preferences/layout-preferences';
import { useViewEntries, useViewState } from '#hooks/use-gallery-view';
import { useState } from 'react';

/**
 * A folder's photos, not its videos or what is in its folders, one below the other to read
 * through as a comic or a scanned book, with no selection: the status bar names the page at
 * the top.
 */
export function ReaderView({ data }: { data: GalleryData }) {
  const { view } = data;
  const state = useViewState(view);
  const [width] = useLayoutPreference('pageWidth');
  const [page, setPage] = useState(0);
  const at = useViewEntries(view, page, page + 1);
  return (
    <GalleryFrame data={data} mode="reader" selected={at(page) ?? null}>
      {state.count > 0 ? (
        <Pages view={view} width={width} onPage={setPage} />
      ) : (
        <EmptyCollection loading={state.loading} />
      )}
    </GalleryFrame>
  );
}
