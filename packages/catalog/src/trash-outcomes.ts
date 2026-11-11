import { addCounts, countOf, noCounts } from '#trash-counts';
import type { TrashCounts, TrashEntry, TrashMove, TrashRow } from '@prism/shared';

/** What becomes of an entry and everything inside it. */
export interface Outcome {
  /** How it leaves its folder entirely, if it does: to the Trash, or moved out. */
  leaves: 'move' | 'trash' | null;
  /** The entries to trash, none inside another. */
  targets: string[];
  moves: TrashMove[];
  rows: TrashRow[];
  /** What goes to the Trash. */
  counts: TrashCounts;
  /** What moves out instead. */
  rescued: TrashCounts;
  /** Conflict rows, for the matching folder they are inside, which counts them. */
  conflicts: number;
}

export function stays(): Outcome {
  return {
    conflicts: 0,
    counts: noCounts(),
    leaves: null,
    moves: [],
    rescued: noCounts(),
    rows: [],
    targets: [],
  };
}

/** `entry` going to the Trash as one, with what is inside it. */
export function trashed(entry: TrashEntry, inside = noCounts()): Outcome {
  return {
    ...stays(),
    counts: addCounts(countOf(entry), inside),
    leaves: 'trash',
    targets: [entry.id],
  };
}

/** `entry` moving into the folder `to`, with everything inside it. */
export function moved(entry: TrashEntry, to: string): Outcome {
  return { ...stays(), leaves: 'move', moves: [{ id: entry.id, to }], rescued: countOf(entry) };
}

/** What becomes of each of `outcomes`, together. */
export function merged(outcomes: Outcome[]): Omit<Outcome, 'leaves'> {
  let counts = noCounts();
  let rescued = noCounts();
  let conflicts = 0;
  for (const outcome of outcomes) {
    counts = addCounts(counts, outcome.counts);
    rescued = addCounts(rescued, outcome.rescued);
    conflicts += outcome.conflicts;
  }
  return {
    conflicts,
    counts,
    moves: outcomes.flatMap((outcome) => outcome.moves),
    rescued,
    rows: outcomes.flatMap((outcome) => outcome.rows),
    targets: outcomes.flatMap((outcome) => outcome.targets),
  };
}

/** `outcome`, shown first as `row`. */
export function withRow(outcome: Outcome, row: TrashRow): Outcome {
  return { ...outcome, rows: [row, ...outcome.rows] };
}
