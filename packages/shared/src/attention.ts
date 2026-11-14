/** The rows a gallery shows of its view, from `start` up to `end`. */
export interface AttendedRows {
  viewId: string;
  start: number;
  end: number;
}

/**
 * What the window has on show, which is all the worker hears of what to read first: it orders
 * every read of the disk by it, and drops what nothing on show wants any more. The window sends
 * it whole each time it changes, and nothing is answered: thumbnails land in the cache, and rows
 * change as the catalog does.
 */
export interface Attention {
  /** Entries whose thumbnails or originals are on show, wherever they are in the window. */
  shown: string[];
  /**
   * Folders on show whose tiles may not say all they will once the worker reads them, such as
   * folders the catalog has not read, or with no photos of their own, whose covers come from
   * inside. The worker reads each once a session, while it is on show.
   */
  tiles: string[];
  /** The rows each gallery shows, whose thumbnails, and those of the rows around them, come first. */
  views: AttendedRows[];
}
