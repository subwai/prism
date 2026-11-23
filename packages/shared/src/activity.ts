/**
 * The kinds of disk work a library's worker schedules. Each kind has its own limit on how many
 * jobs run at once, because each strains something different: decoding uses the CPU, while
 * listing folders and reading files use the disk or the network share. A thumbnail job reads the
 * photo, then hands it to a `decode` job, so more photos can be read at once than decoded.
 */
export const JOB_KINDS = [
  'thumbnail',
  'decode',
  'conversion',
  'folder',
  'tile',
  'details',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export interface JobCounts {
  running: number;
  waiting: number;
}

/**
 * How far a walk through folders has got. A walk is either a view reading its folders, or the
 * library checking every folder.
 */
export interface WalkProgress {
  /** The folders looked at so far. */
  looked: number;
  /** The folders found so far, including those looked at. It grows as the walk finds more. */
  found: number;
  /** Whether the walk reads every folder in full, rather than only those that changed. */
  fullRead: boolean;
}

/**
 * How the library's last look at every folder ended: either the check at launch, or a full
 * read. Once no walk is running, it tells how up to date the catalog's folders are.
 */
export interface FolderCheck extends WalkProgress {
  /** When it ended. The window shows how long ago that was. */
  endedMs: number;
  /**
   * Whether it looked at every folder. One that stopped early, for example after an error, is
   * tried again: a full read resumes from where it stopped at the next launch, and a check
   * runs again when the share comes back.
   */
  complete: boolean;
}

/** How many of a library's photos have had their details read, out of how many it has. */
export interface DetailsProgress {
  /**
   * The photos whose details were read. Photos whose details could not be read count too, as
   * they are done.
   */
  read: number;
  photos: number;
  /** How many of `read` could not actually be read. */
  unreadable: number;
}

/** How far forgetting every photo's details has got, by entry number. */
export interface ForgetProgress {
  /** The last entry number done. */
  done: number;
  /** The largest entry number there is. */
  total: number;
}

/**
 * What a library's worker and its catalog are busy with now, which the status bar shows. The
 * worker counts it from the work it already schedules, and sends it when it changes, at most a
 * few times a second. The window turns it into words.
 */
export interface Activity {
  jobs: Record<JobKind, JobCounts>;
  /** `null` while no walk is running. */
  walk: WalkProgress | null;
  /** `null` until a look at every folder has ended this session. */
  lastCheck: FolderCheck | null;
  /** Entries handed to the catalog that it has not written yet. */
  unsavedEntries: number;
  /** Whether the catalog is sorting a view again, because the catalog changed under it. */
  rebuildingViews: boolean;
  /** Whether the catalog is rebuilding the folder tree's listing, once writes stop. */
  rebuildingTree: boolean;
  /** How far reading photos' details has got across the library; `null` until it is counted. */
  details: DetailsProgress | null;
  /** How far forgetting every photo's details has got; `null` while none is under way. */
  forgettingDetails: ForgetProgress | null;
  /**
   * Whether the share the library is on is offline. While it is, the work above waits for it,
   * and the window shows what the catalog already has.
   */
  offline: boolean;
}

/** An activity with nothing running, as for a worker that has not reported yet. */
export const IDLE_ACTIVITY: Activity = {
  details: null,
  forgettingDetails: null,
  jobs: Object.fromEntries(JOB_KINDS.map((kind) => [kind, { running: 0, waiting: 0 }])) as Record<
    JobKind,
    JobCounts
  >,
  lastCheck: null,
  offline: false,
  rebuildingTree: false,
  rebuildingViews: false,
  unsavedEntries: 0,
  walk: null,
};
