import { useOutletContext } from 'react-router';

/** What the library layout shares with the views inside it. */
export interface LibraryOutletContext {
  /** The grid's thumbnail size, which stays as set while moving between folders. */
  thumbnailSize: number;
  setThumbnailSize: (size: number) => void;
}

export function useThumbnailSize() {
  const { thumbnailSize, setThumbnailSize } = useOutletContext<LibraryOutletContext>();
  return [thumbnailSize, setThumbnailSize] as const;
}
