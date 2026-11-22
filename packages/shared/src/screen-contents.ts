/** The rows a gallery shows of one of its views, from `start` up to, but not including, `end`. */
export interface VisibleRows {
  viewId: string;
  start: number;
  end: number;
}

/**
 * What the window shows right now. The worker uses it to decide which disk work to do first,
 * and it drops queued work that nothing on screen needs any more.
 *
 * The window sends the whole thing again each time it changes, and the worker sends no reply.
 * Results come back by other routes: a thumbnail as a `ThumbnailUpdate` once it is made, and
 * changed rows as a new version of the view.
 */
export interface ScreenContents {
  /** Entries whose thumbnails or full-size images are on screen, anywhere in the window. */
  shown: string[];
  /**
   * Folders on screen whose tiles may still be incomplete, so the worker should look inside
   * them. For example, a folder the catalog has not read yet, or one with no photos of its own,
   * which borrows its covers from a folder inside it. The worker reads each of these once per
   * session, while it is on screen.
   */
  foldersToRead: string[];
  /** The rows each gallery shows. Their thumbnails, and those of nearby rows, are made first. */
  views: VisibleRows[];
}
