import { useOutletContext } from 'react-router';

/** What the library layout shares with the views inside it. */
export interface LibraryOutletContext {
  /** The grid's thumbnail size, which stays as set while moving between folders. */
  thumbnailSize: number;
  setThumbnailSize: (size: number) => void;
  /** The filmstrip's thumbnail size, set by dragging its edge, which also stays as set. */
  filmstripSize: number;
  setFilmstripSize: (size: number) => void;
  /** How wide the reader shows pages, which also stays as set. */
  pageWidth: number;
  setPageWidth: (width: number) => void;
}

export function useThumbnailSize() {
  const { thumbnailSize, setThumbnailSize } = useOutletContext<LibraryOutletContext>();
  return [thumbnailSize, setThumbnailSize] as const;
}

export function usePageWidth() {
  const { pageWidth, setPageWidth } = useOutletContext<LibraryOutletContext>();
  return [pageWidth, setPageWidth] as const;
}

export function useFilmstripSize() {
  const { filmstripSize, setFilmstripSize } = useOutletContext<LibraryOutletContext>();
  return [filmstripSize, setFilmstripSize] as const;
}
