export interface PhotoEntry {
  /** Opaque, session-scoped identifier; never interpret it as an absolute path. */
  id: string;
  parentId: string;
  name: string;
  kind: 'directory' | 'image' | 'file';
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
  /** A candidate directly inside this folder, never a descendant. */
  cover: PhotoEntry | null;
}

export interface ThumbnailRequest {
  requestId: string;
  entryId: string;
  preset: 'grid';
}

export type ThumbnailResult =
  | { status: 'ready'; url: string }
  | { status: 'cancelled' }
  | { status: 'unsupported' }
  | { status: 'failed'; message: string };

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
  getOriginalURL: (entryId: string) => Promise<string>;
}

export const PHOTO_CHANNELS = {
  cancelScan: 'photos:cancel-scan',
  cancelThumbnail: 'photos:cancel-thumbnail',
  closeFolder: 'photos:close-folder',
  getOriginalURL: 'photos:get-original-url',
  inspectFolder: 'photos:inspect-folder',
  nextBatch: 'photos:next-batch',
  openFolder: 'photos:open-folder',
  requestThumbnail: 'photos:request-thumbnail',
  restoreFolder: 'photos:restore-folder',
  startScan: 'photos:start-scan'
} as const;
