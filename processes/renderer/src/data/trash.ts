import { ratingFilterLabel } from '#data/ratings';
import {
  FILTER_FIELDS,
  type FilterField,
  type FolderLocation,
  FORMATS,
  type PhotoEntry,
  type PhotoFilter,
  type TrashChoices,
  type TrashCounts,
  type TrashDecision,
  type TrashDefaults,
  type TrashDestination,
  type TrashEntry,
  type TrashPlan,
  type TrashReason,
  type TrashRow,
  type ViewSpec,
} from '@prism/shared';

/** Where a folder's runs to the Trash go: Prism's own on a network share, with none of its own. */
export function destinationOf(location: FolderLocation): TrashDestination {
  return location === 'network' ? 'prism' : 'system';
}

/** The Trash `destination` is, as a title or button names it. */
export function trashTitle(destination: TrashDestination) {
  return destination === 'prism' ? 'Prism’s Trash' : 'Trash';
}

/** The Trash `destination` is, as a sentence names it. */
export function theTrash(destination: TrashDestination) {
  return destination === 'prism' ? 'Prism’s Trash' : 'the Trash';
}

/**
 * The view a plan to move the matches of `spec` to the Trash is of: everything inside its
 * folder, folders included, narrowed the same way, so it matches as the view does.
 */
export function trashSpecOf(spec: ViewSpec): ViewSpec {
  return {
    ...spec,
    descending: false,
    recursive: true,
    show: 'all',
    sort: 'name',
    suggesting: false,
  };
}

/** What narrows `spec`, as a plan's title names it: `“beach”, ≤ 2 stars, X100V`. */
export function narrowedBy({ search, filter }: Pick<ViewSpec, 'filter' | 'search'>): string {
  const values = FILTER_FIELDS.flatMap((field) =>
    filter[field].map((value) => (field === 'rating' ? ratingFilterLabel(value) : value)),
  );
  const text = search.trim();
  return (text ? [`“${text}”`, ...values] : values).join(', ');
}

export const DECISION_LABELS: Record<TrashDecision, string> = {
  keep: 'Keep',
  only: 'Only matches',
  rescue: 'Rescue',
  trash: 'Trash',
};

/** The reasons the person sets a default for, in the order the sheet shows them. */
export const DEFAULT_REASONS = ['conflict', 'inside', 'empty', 'leftover'] as const;

export const DEFAULT_LABELS: Record<keyof TrashDefaults, string> = {
  conflict: 'Rated higher, inside matching folders',
  empty: 'Folders left empty',
  inside: 'Matches inside kept folders',
  leftover: 'Other files in folders left empty',
};

/** Every row of `plan`, in order. */
export function rowsOf(plan: TrashPlan): TrashRow[] {
  return plan.groups.flatMap((group) => group.rows);
}

/** How many rows of each reason there are, for the defaults that decide them. */
export function reasonCounts(rows: TrashRow[]): Record<TrashReason, number> {
  const counts: Record<TrashReason, number> = {
    conflict: 0,
    empty: 0,
    inside: 0,
    leftover: 0,
    matches: 0,
  };
  for (const row of rows) {
    counts[row.reason] += 1;
  }
  return counts;
}

/** `choices` with each of `rows` that offers `decision` decided so. */
export function decideRows(
  choices: TrashChoices,
  rows: TrashRow[],
  decision: TrashDecision,
): TrashChoices {
  const decisions = { ...choices.decisions };
  for (const row of rows) {
    if (row.options.includes(decision)) {
      decisions[row.entry.id] = decision;
    }
  }
  return { ...choices, decisions };
}

/** `choices` with the rows of `reason` that no one decided by hand decided `decision`. */
export function withDefault<Reason extends keyof TrashDefaults>(
  choices: TrashChoices,
  reason: Reason,
  decision: TrashDefaults[Reason],
): TrashChoices {
  return { ...choices, defaults: { ...choices.defaults, [reason]: decision } };
}

/** How many entries `counts` holds, of every kind. */
export function itemCount(counts: TrashCounts): number {
  return counts.folders + counts.photos + counts.videos + counts.files;
}

function counted(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** `counts` in words: `12 photos, 1 video`. */
export function countsLabel(counts: TrashCounts): string {
  const parts = [
    counts.photos > 0 && counted(counts.photos, 'photo', 'photos'),
    counts.videos > 0 && counted(counts.videos, 'video', 'videos'),
    counts.folders > 0 && counted(counts.folders, 'folder', 'folders'),
    counts.files > 0 && counted(counts.files, 'other file', 'other files'),
  ];
  return parts.filter(Boolean).join(', ') || 'Nothing';
}

/** A value of an entry's for a field a filter narrows by, as a list of what goes shows it. */
export interface FilteredValue {
  field: FilterField;
  text: string;
}

/**
 * The values `entry` has of the fields `filter` narrows by, so a list of what goes shows how each
 * entry stands against it: its stars, or that it has none, its format, camera and lens, and of
 * its tags, those the filter asks for. A field it has no value of says so only for its rating.
 */
export function filteredValues(entry: TrashEntry, filter: PhotoFilter): FilteredValue[] {
  const values: Record<FilterField, (string | undefined)[]> = {
    camera: [entry.exif?.camera],
    format: [FORMATS[entry.kind]],
    lens: [entry.exif?.lens],
    rating: [entry.rating === undefined ? 'Unrated' : '★'.repeat(entry.rating)],
    tag: (entry.exif?.tags ?? []).filter((tag) => filter.tag.includes(tag)),
  };
  return FILTER_FIELDS.filter((field) => filter[field].length > 0).flatMap((field) =>
    values[field].flatMap((text) => (text === undefined ? [] : [{ field, text }])),
  );
}

/** Why `row` is in the plan, as its line says. */
export function reasonLabel(row: TrashRow): string {
  switch (row.reason) {
    case 'conflict': {
      return 'Rated, but its folder matches';
    }
    case 'inside': {
      return 'Matches, inside a folder kept';
    }
    case 'empty': {
      return `Left empty · ${countsLabel(row.contents)}`;
    }
    case 'leftover': {
      return 'Keeps its folder from being left empty';
    }
    default: {
      if (row.entry.kind !== 'directory') {
        return 'Matches';
      }
      const kept =
        row.conflicts > 0 ? ` · ${counted(row.conflicts, 'row', 'rows')} inside to decide` : '';
      return `Matches · ${countsLabel(row.contents)} to the Trash${kept}`;
    }
  }
}

/** `entry` as the window's thumbnails know entries, which are cached by its size and time. */
export function photoEntryOf(entry: TrashEntry): PhotoEntry {
  const photo: PhotoEntry = {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    parentId: entry.parentId,
  };
  if (entry.size !== null) {
    photo.metadata = {
      accessedMs: 0,
      createdMs: 0,
      modifiedMs: entry.modifiedMs ?? 0,
      size: entry.size,
    };
  }
  if (entry.rating !== undefined) {
    photo.rating = entry.rating;
  }
  return photo;
}
