import type { PhotoEntry, PhotoExif } from '#photos';
import type { Rating } from '#ratings';
import type { PhotoFilter } from '#views';

/** An entry as a plan to move a view's matches to the Trash shows it. */
export interface TrashEntry {
  id: string;
  parentId: string;
  name: string;
  kind: PhotoEntry['kind'];
  size: number | null;
  /** When its file last changed. The thumbnail cache uses it to find the entry's thumbnail. */
  modifiedMs: number | null;
  rating?: Rating;
  /** The photo details the Trash sheet filters by, as the gallery's search does. */
  exif?: Pick<PhotoExif, 'camera' | 'lens' | 'tags'>;
}

/** How many entries there are of each kind, and how many bytes their files hold. */
export interface TrashCounts {
  folders: number;
  photos: number;
  videos: number;
  /** Files that no view shows, such as sidecars and formats the app cannot show. */
  files: number;
  size: number;
}

/**
 * What happens to a row of a plan: `keep` leaves it where it is, `trash` sends it to the Trash,
 * and `rescue` moves it out of the matching folder it is in first. For a matching folder,
 * `only` sends to the Trash only the things inside it that match on their own.
 */
export type TrashDecision = 'keep' | 'only' | 'rescue' | 'trash';

/**
 * Why a row is in a plan. The reason sets which decisions the row offers, and its default:
 * - `matches`: it matches the view, and goes.
 * - `conflict`: it is rated and inside a matching folder, but would not match on its own; it
 *   stays.
 * - `inside`: it matches, but is inside a folder kept as a conflict; it stays with that folder.
 * - `empty`: a folder whose contents are all leaving; it goes.
 * - `leftover`: a file that keeps a folder from being left empty, such as a RAW file; it stays.
 */
export type TrashReason = 'conflict' | 'empty' | 'inside' | 'leftover' | 'matches';

/** The default decision for the rows of each reason the user can set. Matches always go. */
export interface TrashDefaults {
  conflict: 'keep' | 'rescue' | 'trash';
  inside: 'keep' | 'trash';
  empty: 'keep' | 'trash';
  leftover: 'keep' | 'trash';
}

/** What the user decided: defaults by reason, and decisions about single rows, by entry ID. */
export interface TrashChoices {
  defaults: TrashDefaults;
  decisions: Record<string, TrashDecision>;
}

/**
 * One decision in a plan, about one entry. A folder that goes stands for everything inside it,
 * so nothing inside it gets a row of its own, except conflicts.
 */
export interface TrashRow {
  entry: TrashEntry;
  reason: TrashReason;
  decision: TrashDecision;
  /** The decisions it offers, in the order to show them. */
  options: TrashDecision[];
  /** Whether the user decided it by hand rather than leaving its default. */
  changed: boolean;
  /** What of it, and of what is inside it, goes to the Trash as decided. */
  contents: TrashCounts;
  /** For a matching folder, how many conflicts inside it have rows of their own. */
  conflicts: number;
  /** Sidecar files that go, or move, along with it. */
  attachments: string[];
  /** For a conflict, the folder that rescuing it moves it to. */
  rescueTo?: string;
}

/** The rows of one folder. */
export interface TrashGroup {
  folderId: string;
  rows: TrashRow[];
}

/** An entry to move into the folder `to` before anything goes to the Trash. */
export interface TrashMove {
  id: string;
  to: string;
}

/**
 * What moving a view's matches to the Trash would do: the rows, grouped by folder in the
 * folders' order; the entries to move out first; and the entries to send to the Trash, none of
 * them inside another.
 */
export interface TrashPlan {
  groups: TrashGroup[];
  moves: TrashMove[];
  targets: string[];
  /** What goes to the Trash. */
  totals: TrashCounts;
  /** What is moved out instead. */
  rescued: TrashCounts;
}

/** An entry that a plan sends to the Trash or moves out of its folder, as the list of them shows it. */
export interface TrashFile {
  entry: TrashEntry;
  /** For a sidecar file, the name of the photo or video it belongs to. */
  owner?: string;
  /** For a rescued entry, the folder it moves to. */
  to?: string;
}

/**
 * Every entry a plan sends to the Trash, one by one at every depth, including those inside
 * folders that go, with folders before what they hold; and the entries it moves out first
 * instead.
 */
export interface TrashFileList {
  trashed: TrashFile[];
  moved: TrashFile[];
}

/** Creates choices that keep everything that needs a look, and send folders left empty to the Trash. */
export function createDefaultTrashChoices(): TrashChoices {
  return {
    decisions: {},
    defaults: { conflict: 'keep', empty: 'trash', inside: 'keep', leftover: 'keep' },
  };
}

/** How far a run of a plan has got through the entries it sends to the Trash. */
export interface TrashProgress {
  done: number;
  total: number;
}

/**
 * Where a run's entries go: `system` is the operating system's Trash; `prism` is Prism's own
 * Trash, at the top of a network share that has no Trash of its own; and `delete` means
 * nowhere, where Prism can't keep a Trash either, so the entries are deleted for good.
 */
export type TrashDestination = 'delete' | 'prism' | 'system';

/** Where a library's runs go, which the window says before the user confirms a run. */
export interface TrashLocation {
  destination: TrashDestination;
  /** The network share the library is on, as the window names it. */
  share?: string;
  /** Why Prism can't keep a Trash on the share, in a few words, when it deletes for good. */
  blocked?: string;
}

/** What running a plan did. */
export interface TrashRunResult {
  destination: TrashDestination;
  /** What `undoTrash` takes to put the run back, or `null` if it moved nothing. */
  runId: string | null;
  /** How many entries went to the Trash. */
  trashed: number;
  /** How many entries were moved out of their folders first. */
  moved: number;
  /** How many entries were gone by the time the plan ran, so it left them alone. */
  skipped: number;
  /** Why it stopped before the end, if it did. The counts say what it did before that. */
  error?: string;
}

/** What undoing a run put back. */
export interface TrashUndoResult {
  restored: number;
  /**
   * The names of entries that came back under a new name, because another entry had taken their
   * place in the meantime.
   */
  renamed: string[];
  /** Why it stopped before the end, if it did. */
  error?: string;
}

/**
 * What the window gets back from a run to the Trash: what it did, or why it could not start,
 * for example because the folder changed.
 */
export type TrashRunOutcome = TrashRunResult | { error: string; runId?: undefined };

/** What the window gets back from undoing a run: what it put back, or why it could not. */
export type TrashUndoOutcome = TrashUndoResult | { error: string; restored?: undefined };

/** The view a run into Prism's Trash came from, as its batch remembers it. */
export interface TrashedView {
  /** The folder whose matches went, as a path from the top of the share. */
  folder: string;
  search: string;
  filter: PhotoFilter;
}

/** A batch in Prism's Trash: what one run on a share moved there. */
export interface PrismTrashBatchInfo {
  /** The name of the batch's folder, which sorts by when its run began. */
  id: string;
  /** When its run began, or `null` if the batch's record can't be read. */
  trashedAt: string | null;
  /** How many of the run's entries it still holds, each with whatever was inside it. */
  items: number;
  /** The view its run came from. Batches made before Prism recorded this don't have it. */
  view?: TrashedView;
}

/** Prism's Trash at the top of a network share, with its batches newest first. */
export interface PrismTrash {
  /** The share, as the window names it. */
  share: string;
  batches: PrismTrashBatchInfo[];
}

/** What the window asks the library's worker, to move a view's matches to the Trash. */
export interface TrashAPI {
  /**
   * What moving the view's entries to the Trash would do as of `version`, including what is
   * inside the folders among them, and conflicts, settled as `choices` say. `null` once that
   * version is gone. The view must show everything inside a folder, folders included.
   */
  viewTrashPlan: (
    viewId: string,
    version: number,
    choices: TrashChoices,
  ) => Promise<TrashPlan | null>;
  /**
   * Every entry that the plan `viewTrashPlan` makes from the same arguments sends to the Trash
   * or moves out of its folder, one by one. `null` once that version is gone.
   */
  viewTrashFiles: (
    viewId: string,
    version: number,
    choices: TrashChoices,
  ) => Promise<TrashFileList | null>;
  /** Subscribes to how far a run to the Trash has got. Returns the unsubscribe function. */
  onTrashProgress: (listener: (progress: TrashProgress) => void) => () => void;
  /** Where runs of the library's views go, which the confirmation of a run names. */
  getTrashLocation: () => Promise<TrashLocation>;
  /**
   * Carries out the plan that `viewTrashPlan` makes from the same arguments: moves the rescued
   * entries out first, then sends the rest to the Trash, or deletes it for good. It refuses
   * unless that goes to `destination`, as the user was told, and stops at the first failure,
   * having done what the result says.
   */
  trashView: (
    viewId: string,
    version: number,
    choices: TrashChoices,
    destination: TrashDestination,
  ) => Promise<TrashRunOutcome>;
  /** Puts back what the run `runId` moved, as far as it can. */
  undoTrash: (runId: string) => Promise<TrashUndoOutcome>;
  /** Prism's Trash on the library's share, or `null` if the library is not on a share. */
  prismTrash: () => Promise<PrismTrash | null>;
  /** What the batch `batchId` of Prism's Trash holds, at every depth. */
  prismTrashContents: (batchId: string) => Promise<TrashCounts>;
  /** Puts what the batch `batchId` holds back where it came from, as far as it can. */
  putBackTrashBatch: (batchId: string) => Promise<TrashUndoOutcome>;
  /** Deletes the batch `batchId` and everything in it for good. */
  deleteTrashBatch: (batchId: string) => Promise<{ error?: string }>;
  /** Deletes everything in Prism's Trash on the library's share for good. */
  emptyPrismTrash: () => Promise<{ error?: string }>;
}
