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

/** How many entries one `readMetadata` call may ask about. */
export const MAX_METADATA_IDS = 1024;

export interface PhotoFolder {
  id: string;
  name: string;
}

/** Whether a folder is on this computer's disks or on a network share. */
export type FolderLocation = 'local' | 'network';

/** The folder the user opened, at the top of the library. */
export interface PhotoRoot extends PhotoFolder {
  location: FolderLocation;
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

/** A video's still, encoded as an image, taken by the window from the video itself. */
export interface ThumbnailFrame {
  entryId: string;
  image: Uint8Array;
}

export type ThumbnailResult =
  | { status: 'ready'; url: string }
  /** A video the system cannot render a still of; the window can, with `storeThumbnail`. */
  | { status: 'frame-needed' }
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

/** What the right-click menu leaves to the window, after handling the rest itself. */
export type EntryMenuAction = 'rename';

/** Where in the window to open a menu, in CSS pixels from its top left corner. */
export interface MenuPosition {
  left: number;
  top: number;
}

export type RenameResult =
  /** The entry under its new name, and the changes that makes to the listings that show it. */
  { entry: PhotoEntry; changes: FolderChange[] } | { error: string };

export interface PhotosAPI {
  openFolder: () => Promise<PhotoRoot | null>;
  /** Reopens the folder from the previous session, if it still exists. */
  restoreFolder: () => Promise<PhotoRoot | null>;
  closeFolder: () => Promise<void>;
  startScan: (options: ScanOptions) => Promise<string>;
  nextBatch: (scanId: string) => Promise<ScanBatch>;
  cancelScan: (scanId: string) => Promise<void>;
  inspectFolder: (directoryId: string) => Promise<FolderSummary>;
  /**
   * The metadata of entries a scan listed, as they are now, for sorts a scan without
   * `metadata` cannot answer; `null` for each that is gone. At most `MAX_METADATA_IDS`.
   */
  readMetadata: (entryIds: string[]) => Promise<(PhotoMetadata | null)[]>;
  /** Forgets what the folder's worker remembers of its folders, so they are read afresh. */
  refresh: () => Promise<void>;
  /** A thumbnail of a photo or video, generated unless it is cached already. */
  requestThumbnail: (entryId: string) => Promise<ThumbnailResult>;
  /** Caches a still the window took of a video, as that video's thumbnail. */
  storeThumbnail: (frame: ThumbnailFrame) => Promise<ThumbnailResult>;
  getOriginalURL: (entryId: string) => Promise<string>;
  /**
   * Opens the system's right-click menu for an entry, such as to reveal it in Finder: at
   * `position` if given, as for a menu opened from the keyboard, or else at the pointer.
   * Resolves once it closes, with the chosen action the window carries out, if any.
   */
  showEntryMenu: (entryId: string, position?: MenuPosition) => Promise<EntryMenuAction | null>;
  /** Renames an entry within its folder; a name already taken is an error, not a replacement. */
  renameEntry: (entryId: string, name: string) => Promise<RenameResult>;
  /** Subscribes to changes inside the open folder; returns the unsubscribe function. */
  onChange: (listener: (changes: FolderChanges) => void) => () => void;
}

/**
 * What the window asks the main process. Everything else about the open folder it asks the
 * folder's worker directly, over the port that arrives on `worker` as the folder opens.
 */
export const PHOTO_CHANNELS = {
  closeFolder: 'photos:close-folder',
  getOriginalURL: 'photos:get-original-url',
  openFolder: 'photos:open-folder',
  restoreFolder: 'photos:restore-folder',
  showEntryMenu: 'photos:show-entry-menu',
  worker: 'photos:worker',
} as const;
