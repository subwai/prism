import type { ViewFacets, ViewSpec, ViewState } from '#views';

export interface PhotoEntry {
  /** Opaque, session-scoped identifier; never interpret it as an absolute path. */
  id: string;
  parentId: string;
  name: string;
  kind: 'directory' | 'image' | 'video' | 'file';
  metadata?: PhotoMetadata;
  /** How a photo was taken, from its EXIF data: present once the catalog has read it. */
  exif?: PhotoExif;
}

export interface PhotoMetadata {
  size: number;
  createdMs: number;
  modifiedMs: number;
  accessedMs: number;
}

/**
 * Whether the photo `name` is HEIF, as iPhones take them. Their pictures are compressed with
 * HEVC, which neither sharp's build nor Chromium decodes, so the system's own codecs show them.
 */
export function isHeif(name: string): boolean {
  return /\.hei[cf]$/iu.test(name);
}

/** Why Windows cannot show a HEIF photo: its codecs come from the Microsoft Store. */
export const HEIF_CODECS_MISSING =
  'Install HEIF Image Extensions and HEVC Video Extensions from the Microsoft Store to show HEIC photos.';

/** What a photo's EXIF data says about it, as far as it says; empty if it has none. */
export interface PhotoExif {
  /** When it was taken, by the camera's clock, read as local time. */
  takenMs?: number;
  /** The camera's make and model, such as "Canon EOS R5". */
  camera?: string;
  lens?: string;
  iso?: number;
  /** The f-number, such as 2.8. */
  aperture?: number;
  exposureSeconds?: number;
  /** In millimetres, as the lens was set rather than its 35 mm equivalent. */
  focalLength?: number;
  /** The keywords it was tagged with, in Windows Explorer, Lightroom and the like. */
  tags?: string[];
}

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

/** An entry, or a folder, that could not be read. */
export interface ReadError {
  entryId: string;
  /** Where it is inside the opened folder, such as `Trips/beach.jpg`, for showing; `.` for that folder itself. */
  path: string;
  message: string;
}

/** A folder's own entries, as the catalog holds them once the folder was read. */
export interface FolderListing {
  entries: PhotoEntry[];
  errors: ReadError[];
  /** Why the folder could not be read at all. */
  error: string | null;
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
  /**
   * Opens a view: a folder's entries, or everything inside it, in order and narrowed as `spec`
   * says. The worker reads its folders into the catalog as it goes, and `onView` tells of each
   * new version. Close it once nothing shows it.
   */
  openView: (spec: ViewSpec) => Promise<ViewState>;
  /** The view's entries from `start`, as of `version`; `null` once that version has gone. */
  viewRows: (
    viewId: string,
    version: number,
    start: number,
    count: number,
  ) => Promise<PhotoEntry[] | null>;
  /**
   * Where `entryId` is in the view as of `version`: -1 if it is not there, and `null` if that
   * version has gone, as `viewRows` says too.
   */
  viewIndexOf: (viewId: string, version: number, entryId: string) => Promise<number | null>;
  /** The values the view's photos have for each field, to filter by. */
  viewFacets: (viewId: string) => Promise<ViewFacets>;
  closeView: (viewId: string) => Promise<void>;
  /** Subscribes to views' new versions; returns the unsubscribe function. */
  onView: (listener: (state: ViewState) => void) => () => void;
  openFolder: () => Promise<PhotoRoot | null>;
  /** Reopens the folder from the previous session, if it still exists. */
  restoreFolder: () => Promise<PhotoRoot | null>;
  closeFolder: () => Promise<void>;
  /** The folder's own entries, folders first, then by name, read from the disk once a session. */
  listFolder: (directoryId: string) => Promise<FolderListing>;
  inspectFolder: (directoryId: string) => Promise<FolderSummary>;
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
