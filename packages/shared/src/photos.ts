export interface PhotoEntry {
  /** Opaque, session-scoped identifier; never interpret it as an absolute path. */
  id: string;
  parentId: string;
  name: string;
  kind: 'directory' | 'image' | 'video' | 'file';
  metadata?: PhotoMetadata;
}

export interface PhotoMetadata {
  size: number;
  createdMs: number;
  modifiedMs: number;
  accessedMs: number;
}

export interface PhotoFolder {
  id: string;
  name: string;
}

export interface ScanOptions {
  directoryId: string;
  recursive?: boolean;
  metadata?: boolean;
  excludeDirectoryIds?: string[];
}

export interface ScanBatch {
  entries: PhotoEntry[];
  errors: { entryId: string; message: string }[];
  done: boolean;
}

export interface FolderSummary {
  hasEntries: boolean;
  hasSubfolders: boolean;
  /**
   * Photos and videos directly inside this folder, never a descendant, to use as its cover:
   * best first, and the next whenever one has no thumbnail.
   */
  covers: PhotoEntry[];
}

export interface ThumbnailRequest {
  requestId: string;
  entryId: string;
  preset: 'grid';
}

/** A video's still, encoded as an image, taken by the window from the video itself. */
export interface ThumbnailFrame {
  entryId: string;
  image: Uint8Array;
}

export type ThumbnailResult =
  | { status: 'ready'; url: string }
  /** A video the system cannot render a still of; the window can, with `storeThumbnail`. */
  | { status: 'frame-needed' }
  | { status: 'cancelled' }
  | { status: 'unsupported' }
  | { status: 'failed'; message: string };

/** An entry that was added, removed, renamed or rewritten on disk. */
export interface FolderChange {
  id: string;
  parentId: string;
  /** The entry as it is now, with its metadata, or `null` once it is gone. */
  entry: PhotoEntry | null;
  /** It appeared, disappeared, or changed kind, so its folder's listing is different. */
  listingChanged: boolean;
  /** Its contents changed since its thumbnail or original was read. */
  contentChanged: boolean;
}

export interface FolderChanges {
  changed: FolderChange[];
  /** Too much changed to list, or the system could not say what: read everything again. */
  everything: boolean;
}

export interface PhotosAPI {
  openFolder: () => Promise<PhotoFolder | null>;
  /** Reopens the folder from the previous session, if it still exists. */
  restoreFolder: () => Promise<PhotoFolder | null>;
  closeFolder: () => Promise<void>;
  startScan: (options: ScanOptions) => Promise<string>;
  nextBatch: (scanId: string) => Promise<ScanBatch>;
  cancelScan: (scanId: string) => Promise<void>;
  inspectFolder: (directoryId: string) => Promise<FolderSummary>;
  requestThumbnail: (request: ThumbnailRequest) => Promise<ThumbnailResult>;
  cancelThumbnail: (requestId: string) => Promise<void>;
  /** Caches a still the window took of a video, as that video's thumbnail. */
  storeThumbnail: (frame: ThumbnailFrame) => Promise<ThumbnailResult>;
  getOriginalURL: (entryId: string) => Promise<string>;
  /** Opens the system's right-click menu for an entry, such as to reveal it in Finder. */
  showEntryMenu: (entryId: string) => Promise<void>;
  /** Subscribes to changes inside the open folder; returns the unsubscribe function. */
  onChange: (listener: (changes: FolderChanges) => void) => () => void;
}

export const PHOTO_CHANNELS = {
  cancelScan: 'photos:cancel-scan',
  cancelThumbnail: 'photos:cancel-thumbnail',
  changed: 'photos:changed',
  closeFolder: 'photos:close-folder',
  getOriginalURL: 'photos:get-original-url',
  inspectFolder: 'photos:inspect-folder',
  nextBatch: 'photos:next-batch',
  openFolder: 'photos:open-folder',
  requestThumbnail: 'photos:request-thumbnail',
  restoreFolder: 'photos:restore-folder',
  showEntryMenu: 'photos:show-entry-menu',
  startScan: 'photos:start-scan',
  storeThumbnail: 'photos:store-thumbnail'
} as const;
