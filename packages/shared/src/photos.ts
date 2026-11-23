import type { Activity } from '#activity';
import type { FolderSummary, OpenedFolders } from '#folders';
import type { Rating } from '#ratings';
import type { ScreenContents } from '#screen-contents';
import type { ThumbnailResult, ThumbnailStillImage, ThumbnailUpdate } from '#thumbnails';
import type { SerializedTreeListing } from '#tree-listing';
import type { ViewFacets, ViewSpec, ViewState } from '#views';

/** A file or folder in the library, as the window shows it. */
export interface PhotoEntry {
  /** Names the entry for this session only. It is not an absolute path, so never use it as one. */
  id: string;
  parentId: string;
  name: string;
  kind: 'directory' | 'image' | 'video' | 'file';
  metadata?: PhotoMetadata;
  /** Missing until the catalog has read the photo's details. */
  exif?: PhotoExif;
  /**
   * The stars it is rated, if any. A photo keeps its rating in its own file, so it is known once
   * the catalog has read the photo's details. Anything else keeps its rating in the app; see
   * `keepsRatingInFile`.
   */
  rating?: Rating;
  /**
   * What a folder's tile shows, which the catalog stores on the folder's row. Missing on other
   * entries, and on folders the catalog has not worked it out for yet.
   */
  summary?: FolderSummary;
}

/** What the file system says about an entry's file. */
export interface PhotoMetadata {
  size: number;
  createdMs: number;
  modifiedMs: number;
  accessedMs: number;
  /**
   * The file's inode: the number the disk knows the file by, or `'0'` if the disk has none. The
   * catalog stores it so it can find the file's thumbnail without asking the disk. Entries read
   * from the catalog leave it out.
   */
  inode?: string;
}

/** What a photo's EXIF data says about how it was taken. Every field is missing if it has none. */
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
  /** In millimetres, as the lens was set, not its 35 mm equivalent. */
  focalLength?: number;
  /** The keywords it was tagged with, in Windows Explorer, Lightroom and similar apps. */
  tags?: string[];
  /** The stars it was rated in XMP, the metadata that Prism, Lightroom and similar apps write. */
  rating?: Rating;
}

export interface PhotoFolder {
  id: string;
  name: string;
}

/** Whether a folder is on one of this computer's own disks or on a network share. */
export type FolderLocation = 'local' | 'network';

/** The folder the user opened, at the top of the library. */
export interface PhotoRoot extends PhotoFolder {
  location: FolderLocation;
  /**
   * Identifies this window's session in `media:` URLs. The main process serves those URLs to
   * this window only.
   */
  session: string;
}

/** An entry or a folder that could not be read. */
export interface ReadError {
  entryId: string;
  /** Where it is in the library, such as `Trips/beach.jpg`, for showing; `.` for the library itself. */
  path: string;
  message: string;
}

/** A folder's entries as the catalog has them. Listing a folder never waits for the disk. */
export interface FolderContents {
  entries: PhotoEntry[];
  /** Whether the catalog has read the whole folder, so `entries` is complete. */
  read: boolean;
  /** Why the folder could not be read at all, the last time this session tried. */
  error: string | null;
  /** Whether the folder is gone: it was moved, renamed or deleted. */
  missing: boolean;
}

/** An entry that was added, removed, renamed or rewritten on disk. */
export interface FolderChange {
  id: string;
  parentId: string;
  /** The entry as it is now, with its metadata, or `null` once it is gone. */
  entry: PhotoEntry | null;
  /** Whether it appeared, disappeared, or changed kind, so its folder's contents changed. */
  folderContentsChanged: boolean;
  /** Whether the file itself changed since its thumbnail or full-size image was read. */
  contentChanged: boolean;
}

/** The entries that changed on disk. */
export interface FolderChanges {
  changed: FolderChange[];
  /** Whether too much changed to list, or the system could not say what: read everything again. */
  everything: boolean;
}

/**
 * What changed in the library, sent as one message so the window applies it all in order:
 * changes on disk, if any, and the new state of the views after them. An update includes every
 * change sent before it, and none sent after it.
 */
export interface LibraryUpdate {
  changes: FolderChanges | null;
  views: ViewState[];
  /**
   * Folders whose list of subfolders changed in the catalog after a read of the disk. The tree
   * reloads them. Changes on disk name the folders they touch themselves, so they are not here.
   */
  folders?: string[];
  /**
   * Folders whose tiles changed, or that were read to the end. The tree reloads them in place.
   * `.` is the library's own folder.
   */
  tiles?: string[];
}

/** Returns the IDs of the entries whose thumbnails and full-size images are now out of date. */
export function findStaleEntryIds(changed: FolderChange[]): string[] {
  return changed.filter((change) => change.contentChanged || !change.entry).map(({ id }) => id);
}

/** The right-click menu actions the window carries out itself. The main process does the rest. */
export type EntryMenuAction = 'rename';

/** Where in the window to open a menu, in CSS pixels from its top left corner. */
export interface MenuPosition {
  left: number;
  top: number;
}

/** The renamed entry and the changes it makes to folders' contents, or why renaming failed. */
export type RenameResult =
  | { kind: 'renamed'; entry: PhotoEntry; changes: FolderChange[] }
  | { kind: 'failed'; error: string };

/** What the window gets back from rating an entry: the entry with its new rating, or why it failed. */
export type RateResult = { kind: 'rated'; entry: PhotoEntry } | { kind: 'failed'; error: string };

/** What the window can ask about the open library. */
export interface PhotosAPI {
  /**
   * Opens a view: a folder's entries, or everything inside it, sorted and filtered as `spec`
   * says. The worker reads the view's folders into the catalog as it goes, and `onUpdate` sends
   * each new version of the view. Close it once nothing shows it.
   */
  openView: (spec: ViewSpec) => Promise<ViewState>;
  /**
   * Returns `count` of the view's entries, starting at `start`. Returns `null` once `version` is
   * no longer the view's current version, since rows of different versions don't fit together.
   */
  viewRows: (
    viewId: string,
    version: number,
    start: number,
    count: number,
  ) => Promise<PhotoEntry[] | null>;
  /**
   * Returns where `entryId` is in the view, or -1 if it is not there. Like `viewRows`, it returns
   * `null` once `version` is out of date.
   */
  viewIndexOf: (viewId: string, version: number, entryId: string) => Promise<number | null>;
  /** The values the view's photos have for each filter field. */
  viewFacets: (viewId: string) => Promise<ViewFacets>;
  /** The entries in the view's folders that could not be read so far, and why. */
  viewErrors: (viewId: string) => Promise<ReadError[]>;
  closeView: (viewId: string) => Promise<void>;
  /**
   * Subscribes to updates of the library: changes on disk and new versions of views, in order.
   * Returns the unsubscribe function.
   */
  onUpdate: (listener: (update: LibraryUpdate) => void) => () => void;
  /**
   * Subscribes to entries whose contents changed or are gone. The worker sends them as soon as it
   * notices, ahead of the update that includes them. Returns the unsubscribe function.
   */
  onStale: (listener: (entryIds: string[]) => void) => () => void;
  /** Subscribes to new thumbnails of entries on screen. Returns the unsubscribe function. */
  onThumbnail: (listener: (update: ThumbnailUpdate) => void) => () => void;
  /**
   * Subscribes to what the open library's worker is busy with. The listener hears the latest
   * state at once, then each change. Returns the unsubscribe function.
   */
  onActivity: (listener: (activity: Activity) => void) => () => void;
  openFolder: () => Promise<PhotoRoot | null>;
  /** Opens the library from the previous session again, if its folder still exists. */
  restoreFolder: () => Promise<PhotoRoot | null>;
  /**
   * Subscribes to whether the catalog is being upgraded as a library opens, which can take a
   * minute on a large one. Returns the unsubscribe function.
   */
  onUpgrading: (listener: (upgrading: boolean) => void) => () => void;
  closeFolder: () => Promise<void>;
  /** The folders the tree had opened or closed the last time this library was open. */
  openedFolders: () => Promise<OpenedFolders>;
  /**
   * Remembers the tree's opened and closed folders for the next time the library opens. It
   * names the `session` they belong to, so a library opened since then does not take them.
   */
  rememberOpenedFolders: (session: string, folders: OpenedFolders) => Promise<void>;
  /** The folder inside the library that the window showed last, if it remembers one. */
  currentFolder: () => Promise<string | null>;
  /**
   * Remembers the folder inside the library that the window shows, to show it again the next
   * time the library opens. It names the `session`, as `rememberOpenedFolders` does.
   */
  rememberCurrentFolder: (session: string, folderId: string) => Promise<void>;
  /** The folder's own entries as the catalog has them, folders first, then by name. */
  listFolder: (directoryId: string) => Promise<FolderContents>;
  /** Returns the subfolders the catalog knows inside each of `parentIds`. */
  listSubfolders: (parentIds: string[]) => Promise<SerializedTreeListing>;
  /** Returns the folders `folderIds` themselves. The tree calls it when their tiles change. */
  listFoldersById: (folderIds: string[]) => Promise<SerializedTreeListing>;
  /**
   * Returns every folder the catalog knows, as text from `treeListingToText`. Text crosses
   * between processes in one copy, while tens of thousands of arrays are copied one by one.
   */
  listWholeTree: () => Promise<string>;
  /** Tells the worker what the window shows, so it does that disk work first; see `ScreenContents`. */
  reportScreenContents: (contents: ScreenContents) => Promise<void>;
  /** Makes the worker forget what it knows of the library's folders, so they are read again. */
  refresh: () => Promise<void>;
  /** Stores a still image the window took of a video as that video's thumbnail. */
  storeThumbnail: (stillImage: ThumbnailStillImage) => Promise<ThumbnailResult>;
  getOriginalURL: (entryId: string) => Promise<string>;
  /**
   * Opens the system's right-click menu for an entry, with actions such as revealing it in
   * Finder. It opens at `position` if given, as for a menu opened from the keyboard, or else at
   * the pointer. Resolves once the menu closes, with the action left for the window, if any.
   */
  showEntryMenu: (entryId: string, position?: MenuPosition) => Promise<EntryMenuAction | null>;
  /** Renames an entry within its folder. A name already taken is an error, never a replacement. */
  renameEntry: (entryId: string, name: string) => Promise<RenameResult>;
  /**
   * Rates an entry, or removes its rating with `null`. A photo's rating is written into its
   * file; anything else's is kept by the app.
   */
  rateEntry: (entryId: string, rating: Rating | null) => Promise<RateResult>;
}

/**
 * The channels on which the window asks the main process. For everything else about the open
 * library, the window asks the library's worker directly, over the message port that arrives on
 * `worker` when the library opens.
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
  upgrading: 'photos:upgrading',
  worker: 'photos:worker',
} as const;
