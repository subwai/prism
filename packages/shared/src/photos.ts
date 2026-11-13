import type { Rating } from '#ratings';
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
  /**
   * The stars it was rated, if any: a photo's from its own file, once the catalog has read its
   * details, and anything else's from the app's own ratings; see `ratesInFile`.
   */
  rating?: Rating;
}

export interface PhotoMetadata {
  size: number;
  createdMs: number;
  modifiedMs: number;
  accessedMs: number;
  /**
   * The file's inode as a read of the disk found it, `'0'` where the disk reports none. The
   * catalog keeps it to name the file's thumbnail without the disk; entries read from the
   * catalog leave it out.
   */
  inode?: string;
}

/**
 * Whether the photo `name` is HEIF, as iPhones take them. Their pictures are compressed with
 * HEVC, which neither sharp's build nor Chromium decodes, so the system's own codecs show them.
 */
export function isHeif(name: string): boolean {
  return /\.hei[cf]$/iu.test(name);
}

/**
 * Whether the window is shown a conversion of the photo `name` rather than its file: HEIF, and
 * TIFF, which Chromium does not decode either.
 */
export function needsConversion(name: string): boolean {
  return isHeif(name) || /\.tiff?$/iu.test(name);
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
  /** The stars it was rated in XMP, as Prism, Lightroom and the like write it. */
  rating?: Rating;
}

export interface PhotoFolder {
  id: string;
  name: string;
}

/**
 * The folders the sidebar's tree opened or closed by hand, by ID, which it opens again as it
 * left them the next time the same folder opens.
 */
export type OpenedFolders = [id: string, open: boolean][];

/** Whether a folder is on this computer's disks or on a network share. */
export type FolderLocation = 'local' | 'network';

/** The folder the user opened, at the top of the library. */
export interface PhotoRoot extends PhotoFolder {
  location: FolderLocation;
  /** Names the window's session of the folder in its `media:` URLs, which only it serves. */
  session: string;
}

/**
 * Where the window finds `entry`'s thumbnail if it is cached already, with no call to make it
 * first: the main process serves the cached file, or answers 404 if there is none, and then
 * `requestThumbnail` makes one. The query changes with the file's size and modified time, as
 * the thumbnail does, and with `generation`, which a refresh raises to have them read again.
 */
export function cachedThumbnailURL(session: string, entry: PhotoEntry, generation = 0): string {
  const { metadata } = entry;
  const version = [metadata?.size, metadata?.modifiedMs, generation].join('-');
  return `media://thumbnail/${session}/${encodeURIComponent(entry.id)}?v=${version}`;
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
  /** Nothing is there any more: the folder was moved, renamed or deleted. */
  missing: boolean;
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

/**
 * What changed in the library, in one message so the window applies it in order: changes on
 * disk, if any, and the views' states as of them. A version told here holds every change told
 * before it, and none told after.
 */
export interface LibraryUpdate {
  changes: FolderChanges | null;
  views: ViewState[];
}

/** The entries whose thumbnails and originals are out of date, as rewritten or gone. */
export function staleEntries(changed: FolderChange[]): string[] {
  return changed.filter((change) => change.contentChanged || !change.entry).map(({ id }) => id);
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

export type RateResult =
  /** The entry with its new rating. */
  { entry: PhotoEntry } | { error: string };

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
  /** The entries the view's folders held that could not be read, and why, as far as it has read. */
  viewErrors: (viewId: string) => Promise<ReadError[]>;
  closeView: (viewId: string) => Promise<void>;
  /**
   * Subscribes to updates of the library: changes on disk and views' new versions, in order;
   * returns the unsubscribe function.
   */
  onUpdate: (listener: (update: LibraryUpdate) => void) => () => void;
  /**
   * Subscribes to entries whose contents changed or are gone, told as soon as the worker
   * notices, ahead of the update that holds them; returns the unsubscribe function.
   */
  onStale: (listener: (entryIds: string[]) => void) => () => void;
  openFolder: () => Promise<PhotoRoot | null>;
  /** Reopens the folder from the previous session, if it still exists. */
  restoreFolder: () => Promise<PhotoRoot | null>;
  closeFolder: () => Promise<void>;
  /** The folders the tree had opened or closed when the open folder was last open. */
  openedFolders: () => Promise<OpenedFolders>;
  /**
   * Remembers the tree's opened and closed folders for the next time the folder opens. It names
   * the `session` they are of, so a folder opened since does not take them.
   */
  rememberOpenedFolders: (session: string, folders: OpenedFolders) => Promise<void>;
  /** The folder inside the open one the window last showed, if it remembers one. */
  currentFolder: () => Promise<string | null>;
  /**
   * Remembers the folder inside the open one the window shows, to show it again the next time
   * the folder opens. It names the `session` it is of, as `rememberOpenedFolders` does.
   */
  rememberCurrentFolder: (session: string, folderId: string) => Promise<void>;
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
  /**
   * Rates an entry, or with `null` takes its rating away: a photo's is written into its file,
   * and anything else's kept by the app.
   */
  rateEntry: (entryId: string, rating: Rating | null) => Promise<RateResult>;
}

/**
 * What the window asks the main process. Everything else about the open folder it asks the
 * folder's worker directly, over the port that arrives on `worker` as the folder opens.
 */
export const PHOTO_CHANNELS = {
  closeFolder: 'photos:close-folder',
  currentFolder: 'photos:current-folder',
  getOriginalURL: 'photos:get-original-url',
  openFolder: 'photos:open-folder',
  openedFolders: 'photos:opened-folders',
  rememberCurrentFolder: 'photos:remember-current-folder',
  rememberOpenedFolders: 'photos:remember-opened-folders',
  restoreFolder: 'photos:restore-folder',
  showEntryMenu: 'photos:show-entry-menu',
  worker: 'photos:worker',
} as const;
