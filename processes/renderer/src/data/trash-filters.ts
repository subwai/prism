import { filterGroup } from '#data/filters';
import type { SearchToken, TokenGroup } from '@prism/design-system';
import {
  FILTER_FIELDS,
  type FilterChoice,
  FORMATS,
  passesRatingFilter,
  type PhotoEntry,
  RATING_FILTERS,
  type TrashPlan,
  type TrashReason,
  type TrashRow,
} from '@prism/shared';

/** The quick ways to narrow the sheet's rows to those to decide on together. */
export const TRASH_TABS = ['all', 'look', 'changed', 'keep', 'trash', 'rescue'] as const;
export type TrashTab = (typeof TRASH_TABS)[number];

export const TAB_LABELS: Record<TrashTab, string> = {
  all: 'All',
  changed: 'Changed',
  keep: 'Keep',
  look: 'Needs a look',
  rescue: 'Rescue',
  trash: 'Trash',
};

/** What the sheet shows of a plan's rows: a tab, chips, and text in a name or folder. */
export interface SheetFilter {
  tab: TrashTab;
  tokens: SearchToken[];
  query: string;
}

export const NO_SHEET_FILTER: SheetFilter = { query: '', tab: 'all', tokens: [] };

/** Rows the person said otherwise of, by rating them, or that keep what would otherwise go. */
function needsLook(row: TrashRow) {
  return row.reason === 'conflict' || row.reason === 'inside' || row.reason === 'leftover';
}

function inTab(row: TrashRow, tab: TrashTab): boolean {
  switch (tab) {
    case 'all': {
      return true;
    }
    case 'look': {
      return needsLook(row);
    }
    case 'changed': {
      return row.changed;
    }
    case 'trash': {
      return row.decision === 'trash' || row.decision === 'only';
    }
    default: {
      return row.decision === tab;
    }
  }
}

/** How many rows each tab holds. */
export function tabCounts(rows: TrashRow[]): Record<TrashTab, number> {
  return Object.fromEntries(
    TRASH_TABS.map((tab) => [tab, rows.filter((row) => inTab(row, tab)).length]),
  ) as Record<TrashTab, number>;
}

/**
 * The fields the sheet's chips narrow by: the gallery's search's, so they narrow as it does, and
 * why each row is in the plan and which folder holds it.
 */
const FIELDS = [...FILTER_FIELDS, 'reason', 'folder'] as const;
type SheetField = (typeof FIELDS)[number];

/** What a row's format reads as: as the gallery's search says it, or what else it is. */
const OTHER_FORMATS: Partial<Record<PhotoEntry['kind'], string>> = {
  directory: 'Folder',
  file: 'Other file',
};

/** The values `row` has of `field`; for a rating, every rating filter that lets it through. */
function valuesOf({ entry, reason }: TrashRow, field: SheetField): string[] {
  switch (field) {
    case 'rating': {
      return RATING_FILTERS.filter((filter) => passesRatingFilter(filter, entry.rating));
    }
    case 'format': {
      return [FORMATS[entry.kind] ?? OTHER_FORMATS[entry.kind] ?? entry.kind];
    }
    case 'camera':
    case 'lens': {
      const value = entry.exif?.[field];
      return value === undefined ? [] : [value];
    }
    case 'tag': {
      return entry.exif?.tags ?? [];
    }
    case 'reason': {
      return [reason];
    }
    default: {
      return [entry.parentId];
    }
  }
}

const REASON_LABELS: Record<TrashReason, string> = {
  conflict: 'Rated, in a matching folder',
  empty: 'Left empty',
  inside: 'Matches, in a folder kept',
  leftover: 'Keeps its folder',
  matches: 'Matches',
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The values `rows` have of `field`, and how many rows have each, in the order to offer them. */
function choicesOf(rows: TrashRow[], field: SheetField): FilterChoice[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of valuesOf(row, field)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const choices = [...counts].map(([value, count]) => ({ count, value }));
  return field === 'rating'
    ? RATING_FILTERS.flatMap((value) => choices.filter((choice) => choice.value === value))
    : choices.toSorted((left, right) => collator.compare(left.value, right.value));
}

/** What the sheet's chips can narrow `rows` to, and how many rows have each value. */
export function sheetGroups(rows: TrashRow[]): TokenGroup[] {
  return [
    ...FILTER_FIELDS.map((field) => filterGroup(field, choicesOf(rows, field))),
    {
      field: 'reason',
      format: (value: string) => REASON_LABELS[value as TrashReason],
      label: 'Why',
      values: choicesOf(rows, 'reason'),
    },
    {
      field: 'folder',
      format: (value: string) => (value === '.' ? 'Top folder' : value),
      label: 'Folder',
      values: choicesOf(rows, 'folder'),
    },
  ];
}

/** Whether `row` is shown: in the tab, with a value of each field chips chose, and the text. */
function passes(row: TrashRow, { tab, tokens, query }: SheetFilter) {
  const text = query.trim().toLocaleLowerCase();
  return (
    inTab(row, tab) &&
    FIELDS.every((field) => {
      const chosen = tokens.filter((token) => token.field === field);
      return (
        chosen.length === 0 || chosen.some((token) => valuesOf(row, field).includes(token.value))
      );
    }) &&
    (!text ||
      row.entry.name.toLocaleLowerCase().includes(text) ||
      row.entry.parentId.toLocaleLowerCase().includes(text))
  );
}

/** A line of the sheet's list: a folder's heading over the rows shown of it, or a row. */
export type TrashLine =
  | { type: 'folder'; folderId: string; rows: TrashRow[]; collapsed: boolean }
  | { type: 'row'; row: TrashRow };

/** What the sheet lists of `plan`: the rows `filter` shows, under their folder's heading. */
export function linesOf(
  plan: TrashPlan,
  filter: SheetFilter,
  collapsed: ReadonlySet<string>,
): TrashLine[] {
  return plan.groups.flatMap((group): TrashLine[] => {
    const rows = group.rows.filter((row) => passes(row, filter));
    if (rows.length === 0) {
      return [];
    }
    const closed = collapsed.has(group.folderId);
    const heading: TrashLine = {
      collapsed: closed,
      folderId: group.folderId,
      rows,
      type: 'folder',
    };
    return closed ? [heading] : [heading, ...rows.map((row): TrashLine => ({ row, type: 'row' }))];
  });
}

/** The rows `lines` show, a collapsed folder's included, in order. */
export function rowsShown(lines: TrashLine[]): TrashRow[] {
  return lines.flatMap((line) => {
    if (line.type === 'row') {
      return [line.row];
    }
    return line.collapsed ? line.rows : [];
  });
}
