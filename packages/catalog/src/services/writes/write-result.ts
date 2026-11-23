/** What the sidebar's tree reads again after a write. */
export interface TreeChanges {
  /** Folders whose subfolders the write added or removed. */
  folders: string[];
  /** Folders whose tiles the write changed or marked read. */
  tiles: string[];
}

/** What a write found out about photos' details. */
export interface PhotoChanges {
  /**
   * Photos whose details the write left out, because their files changed after they were read
   * or found unreadable.
   */
  changedSinceRead: number[];
  /** Photos listed with no details read yet. */
  newlyUnread: number[];
  /** IDs of photos with no details the catalog could reuse, so the details reader reads their files. */
  toRead: string[];
}

/** What a write changed, for the writer to report. */
export interface WriteResult extends TreeChanges, PhotoChanges {
  /** Whether the write changed any row a view may show. */
  changed: boolean;
  /** Whether all it wrote was photos' details, which most views' orders never read. */
  onlyDetails: boolean;
  /** Whether it changed what the tree listing shows, so the stored listing was deleted. */
  treeChanged: boolean;
}
