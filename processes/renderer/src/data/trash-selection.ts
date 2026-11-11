/** The rows selected, by ID, and the one a Shift-click selects from. */
export interface Selection {
  ids: ReadonlySet<string>;
  anchor: string | null;
}

export const NO_SELECTION: Selection = { anchor: null, ids: new Set() };

/**
 * The selection after a click on `id`, as Finder's lists have it: alone, or none if it was
 * already selected alone, or with `toggle`
 * (Command) in or out of what is selected, or with `extend` (Shift) every row of `shown` from
 * the last one clicked to it added.
 */
export function selectRow(
  selection: Selection,
  id: string,
  shown: string[],
  { extend = false, toggle = false } = {},
): Selection {
  if (extend && selection.anchor !== null) {
    const from = shown.indexOf(selection.anchor);
    const to = shown.indexOf(id);
    if (from !== -1 && to !== -1) {
      const range = shown.slice(Math.min(from, to), Math.max(from, to) + 1);
      return { anchor: selection.anchor, ids: new Set([...selection.ids, ...range]) };
    }
  }
  if (toggle) {
    const ids = new Set(selection.ids);
    if (!ids.delete(id)) {
      ids.add(id);
    }
    return { anchor: id, ids };
  }
  // Clicking the one row selected again lets it go.
  if (selection.ids.size === 1 && selection.ids.has(id)) {
    return NO_SELECTION;
  }
  return { anchor: id, ids: new Set([id]) };
}

/** Every row of `shown` added to `selection`, whose rows hidden by a filter stay selected. */
export function selectAll(selection: Selection, shown: string[]): Selection {
  return { anchor: shown[0] ?? null, ids: new Set([...selection.ids, ...shown]) };
}

/** Of `rows`, those `selection` holds. */
export function selectedAmong<Row extends { entry: { id: string } }>(
  selection: Selection,
  rows: Row[],
): Row[] {
  return rows.filter((row) => selection.ids.has(row.entry.id));
}
