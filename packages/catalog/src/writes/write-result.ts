/** What the sidebar's tree reads again after a write. */
export interface TreeChanges {
  /** Folders whose subfolders the write added or removed. */
  folders: string[];
  /** Folders whose tiles the write changed or marked read. */
  tiles: string[];
}

/** What a write changed, for the writer to report. */
export interface WriteResult extends TreeChanges {
  /**
   * Photos whose details the write left out, as their files changed since they were read or
   * found unreadable.
   */
  changedSinceRead: number[];
  /** Photos listed with no details read yet. */
  newlyUnread: number[];
  /** IDs of photos with no details the catalog could reuse, so the enricher reads their files. */
  toRead: string[];
  /** Whether the write changed any row a view may show. */
  changed: boolean;
  /** Whether all it wrote was photos' details, which most views' orders never read. */
  onlyDetails: boolean;
  /** Whether it changed what the tree listing shows, so the stored listing was deleted. */
  treeChanged: boolean;
}

/** What a write touched, gathered as it goes, to work out what changed once it is done. */
export interface WriteEffects {
  /** Folders whose tiles the write may change. */
  folders: Set<string>;
  /** Files listed anew, whose thumbnails change. */
  rewritten: Set<number>;
  /** Folders newly marked read to the end. */
  read: Set<string>;
  /** Folders whose subfolders the write added, changed or removed. */
  subfolders: Set<string>;
  /** Rows it changed that no view shows, so views need not be built again for them. */
  unshown: number;
}
