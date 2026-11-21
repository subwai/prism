/**
 * The kinds of disk work a folder's worker orders in its scheduler, each with limits of its own,
 * as each wears on something else: decodes on the CPU, listings and reads on the disk or share.
 * A thumbnail's job reads its photo, and decodes it in a job of the `decode` lane, so more photos
 * are read at once than decoded.
 */
export const LANES = ['thumbnail', 'decode', 'conversion', 'folder', 'tile', 'details'] as const;
export type Lane = (typeof LANES)[number];

/** How many jobs of a kind run now, and how many wait their turn. */
export interface Jobs {
  running: number;
  waiting: number;
}

/** How far a walk of folders has got: a view's read, or the library's check of every folder. */
export interface WalkProgress {
  /** The folders looked at so far. */
  looked: number;
  /** The folders found so far, those looked at included, which grows as reads find more. */
  found: number;
  /** Whether a walk reads every folder in full, rather than only those that changed. */
  full: boolean;
}

/** How many of a library's photos have their details read, of how many it has. */
export interface DetailsProgress {
  read: number;
  photos: number;
}

/**
 * What a folder's worker and its catalog are busy with now, which the status bar shows. The
 * worker counts it from what already orders the work, and sends it as it changes, a few times a
 * second at most; the window puts it into words.
 */
export interface Activity {
  jobs: Record<Lane, Jobs>;
  /** `null` while no walk is under way. */
  walk: WalkProgress | null;
  /** Entries handed to the catalog that it has not written yet. */
  saving: number;
  /** Whether the catalog is making a view's order again, as the catalog changed under it. */
  views: boolean;
  /** Whether the catalog is making the folder tree's skeleton again, once writes stop. */
  skeleton: boolean;
  /** How far reading photos' details has got across the library; `null` until it is counted. */
  details: DetailsProgress | null;
}

/** Nothing under way, as with a worker that has not said otherwise. */
export const IDLE_ACTIVITY: Activity = {
  details: null,
  jobs: Object.fromEntries(LANES.map((lane) => [lane, { running: 0, waiting: 0 }])) as Record<
    Lane,
    Jobs
  >,
  saving: 0,
  skeleton: false,
  views: false,
  walk: null,
};
