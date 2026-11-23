import type { TrashEntry } from '@prism/shared';

/** An entry inside the folder a plan is of, as the planner judges it. */
export interface PlanEntry extends TrashEntry {
  /** Whether the view's search and filters let it through. */
  matches: boolean;
}

/** `entry` as the window is shown it. */
export function trashEntry({
  exif,
  id,
  kind,
  modifiedMs,
  name,
  parentId,
  rating,
  size,
}: PlanEntry): TrashEntry {
  const shown: TrashEntry = { id, kind, modifiedMs, name, parentId, size };
  if (rating !== undefined) {
    shown.rating = rating;
  }
  if (exif !== undefined) {
    shown.exif = exif;
  }
  return shown;
}
