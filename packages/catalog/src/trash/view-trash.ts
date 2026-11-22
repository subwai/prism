import { treeInside, type TreeItem } from '#data/items';
import { storedItemRatings } from '#stored-ratings';
import { listTrashFiles } from '#trash/list-trash-files';
import { type PlanEntry, planTrash } from '#trash/plan-trash';
import type { ViewSources } from '#views/catalog-views';
import {
  isRating,
  type TrashChoices,
  type TrashEntry,
  type TrashFileList,
  type TrashPlan,
} from '@prism/shared';

/** The details of `row` the sheet filters by, if it has any. */
function detailsOf({ camera, lens, tags }: TreeItem): TrashEntry['exif'] {
  if (camera === null && lens === null && tags.length === 0) {
    return undefined;
  }
  const exif: NonNullable<TrashEntry['exif']> = {};
  if (camera !== null) {
    exif.camera = camera;
  }
  if (lens !== null) {
    exif.lens = lens;
  }
  if (tags.length > 0) {
    exif.tags = tags;
  }
  return exif;
}

/**
 * Everything inside `folderId`, as a plan judges it: whether each is among `matches`, the
 * entries a view of everything inside it lets through, so they match as they do anywhere else,
 * and its rating from either place ratings are kept.
 */
function entriesOf(
  { db, library, stored }: ViewSources,
  folderId: string,
  matches: Int32Array,
): PlanEntry[] {
  const matching = new Set(matches);
  const kept = new Map(
    storedItemRatings(db, library, stored).map(({ item, rating }) => [item, rating]),
  );
  return treeInside(db, library, folderId).map((row) => {
    const entry: PlanEntry = {
      id: row.id,
      kind: row.kind,
      matches: matching.has(row.item),
      modifiedMs: row.modifiedMs,
      name: row.name,
      parentId: row.parentId,
      size: row.size,
    };
    const rating = isRating(row.rating) ? row.rating : kept.get(row.item);
    if (rating !== undefined) {
      entry.rating = rating;
    }
    const exif = detailsOf(row);
    if (exif) {
      entry.exif = exif;
    }
    return entry;
  });
}

/** What moving the matches inside `folderId` to the Trash would move, as `choices` decide. */
export function planViewTrash(
  sources: ViewSources,
  folderId: string,
  matches: Int32Array,
  choices: TrashChoices,
): TrashPlan {
  return planTrash(folderId, entriesOf(sources, folderId, matches), choices);
}

/** Every entry the plan `planViewTrash` makes would move, one by one. */
export function listViewTrashFiles(
  sources: ViewSources,
  folderId: string,
  matches: Int32Array,
  choices: TrashChoices,
): TrashFileList {
  const entries = entriesOf(sources, folderId, matches);
  return listTrashFiles(folderId, entries, planTrash(folderId, entries, choices));
}
