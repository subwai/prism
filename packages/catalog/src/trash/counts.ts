import type { PhotoEntry, TrashCounts, TrashEntry } from '@prism/shared';

/** No entries. */
export function noCounts(): TrashCounts {
  return { files: 0, folders: 0, photos: 0, size: 0, videos: 0 };
}

export function addCounts(left: TrashCounts, right: TrashCounts): TrashCounts {
  return {
    files: left.files + right.files,
    folders: left.folders + right.folders,
    photos: left.photos + right.photos,
    size: left.size + right.size,
    videos: left.videos + right.videos,
  };
}

const COUNTED: Record<PhotoEntry['kind'], keyof TrashCounts> = {
  directory: 'folders',
  file: 'files',
  image: 'photos',
  video: 'videos',
};

/** One entry, as counts. */
export function countOf(entry: TrashEntry): TrashCounts {
  return { ...noCounts(), [COUNTED[entry.kind]]: 1, size: entry.size ?? 0 };
}
