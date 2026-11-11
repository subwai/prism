import type { PhotoEntry, PhotoExif } from '#photos';
import type { Rating } from '#ratings';

/** An entry as a plan to move matches to the Trash shows it. */
export interface TrashEntry {
  id: string;
  parentId: string;
  name: string;
  kind: PhotoEntry['kind'];
  size: number | null;
  /** When its file last changed, which its thumbnail is cached by. */
  modifiedMs: number | null;
  rating?: Rating;
  /** A photo's details the sheet filters by, as the gallery's search does. */
  exif?: Pick<PhotoExif, 'camera' | 'lens' | 'tags'>;
}

/** How many entries of each kind, and how many bytes their files hold. */
export interface TrashCounts {
  folders: number;
  photos: number;
  videos: number;
  /** Files no view shows, such as sidecars and formats the app cannot show. */
  files: number;
  size: number;
}

/**
 * What becomes of a row: it stays, goes to the Trash, moves out of the matching folder it is in
 * (`rescue`), or, for a matching folder, has only what inside it matches on its own go (`only`).
 */
export type TrashDecision = 'keep' | 'only' | 'rescue' | 'trash';

/**
 * Why a row is in a plan, which sets the decisions it offers and its default:
 * - `matches`: it matches, and goes.
 * - `conflict`: rated, inside a matching folder, but would not match on its own; it stays.
 * - `inside`: it matches, inside a folder kept as a conflict; it stays with that folder.
 * - `empty`: a folder everything inside is leaving; it goes.
 * - `leftover`: a file that keeps a folder from being left empty, such as a RAW file; it stays.
 */
export type TrashReason = 'conflict' | 'empty' | 'inside' | 'leftover' | 'matches';

/** The default decision of the rows of each reason the person can set; matches always go. */
export interface TrashDefaults {
  conflict: 'keep' | 'rescue' | 'trash';
  inside: 'keep' | 'trash';
  empty: 'keep' | 'trash';
  leftover: 'keep' | 'trash';
}

/** What the person decided: defaults by reason, and rows decided by hand, by entry ID. */
export interface TrashChoices {
  defaults: TrashDefaults;
  decisions: Record<string, TrashDecision>;
}

/**
 * One decision in a plan, about one entry. A folder that goes stands for everything inside it,
 * which is never listed again, but for conflicts, which are rows of their own.
 */
export interface TrashRow {
  entry: TrashEntry;
  reason: TrashReason;
  decision: TrashDecision;
  /** The decisions it offers, in the order to show them. */
  options: TrashDecision[];
  /** Decided by hand rather than by its default. */
  changed: boolean;
  /** What of it, and inside it, goes to the Trash as decided. */
  contents: TrashCounts;
  /** For a matching folder, how many conflicts inside it are rows of their own. */
  conflicts: number;
  /** Sidecars that go, or move, with it. */
  attachments: string[];
  /** For a conflict, the folder rescuing it moves it to. */
  rescueTo?: string;
}

/** The rows of one folder. */
export interface TrashGroup {
  folderId: string;
  rows: TrashRow[];
}

/** An entry to move into `to`, a folder, before anything goes to the Trash. */
export interface TrashMove {
  id: string;
  to: string;
}

/**
 * What moving a view's matches to the Trash would do: rows grouped by folder, in the folders'
 * order; the entries to move out first; and the entries to trash, none inside another.
 */
export interface TrashPlan {
  groups: TrashGroup[];
  moves: TrashMove[];
  targets: string[];
  /** What goes to the Trash. */
  totals: TrashCounts;
  /** What moves out instead. */
  rescued: TrashCounts;
}

/** An entry a plan moves to the Trash or out of its folder, as the list of them shows it. */
export interface TrashFile {
  entry: TrashEntry;
  /** For a sidecar, the name of the photo or video it belongs to. */
  owner?: string;
  /** For an entry rescued, the folder it moves to. */
  to?: string;
}

/**
 * Every entry a plan moves to the Trash, one by one at every depth, those inside folders that
 * go included, folders before what they hold; and the entries it moves out first instead.
 */
export interface TrashFiles {
  trashed: TrashFile[];
  moved: TrashFile[];
}

/** Choices that keep what needs a look, and trash folders left empty. */
export function noTrashChoices(): TrashChoices {
  return {
    decisions: {},
    defaults: { conflict: 'keep', empty: 'trash', inside: 'keep', leftover: 'keep' },
  };
}
