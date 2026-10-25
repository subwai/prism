import { useOutletContext } from 'react-router';

/** What the library layout shares with the views inside it. */
export interface LibraryOutletContext {
  /** The grid's thumbnail size, which stays as set while moving between folders. */
  thumbnailSize: number;
  setThumbnailSize: (size: number) => void;
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
