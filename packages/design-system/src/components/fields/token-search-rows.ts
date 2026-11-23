/** The rows of `TokenSearchField`'s list, and how its values become them. */

/** A value chosen for one of the field's fields, shown as a chip before what is typed. */
export interface SearchToken {
  field: string;
  value: string;
}

/** The values one field can take, which typing suggests, and how many results have each. */
export interface TokenGroup {
  field: string;
  label: string;
  values: { value: string; count: number }[];
  /** How a value reads, in the list and on its chip, if not as it is: `min3` as `≥ 3 stars`. */
  format?: (value: string) => string;
  /**
   * The section of the opened field's list a value is in, such as `At least` for `min3`;
   * values without one are set apart under a line. Sections follow the values' order.
   */
  section?: (value: string) => string | undefined;
}

/**
 * Text as typing matches it: without spaces, and with `>=` and `<=` read as `≥` and `≤`, so
 * `>=3` finds `≥ 3 stars`.
 */
export function toMatchableText(text: string) {
  return text.replaceAll('>=', '≥').replaceAll('<=', '≤').replaceAll(/\s+/gu, '');
}

/**
 * A row of the list: a value to choose, a field to open and see its values, or the way back
 * from one. Opening and going back are rows too, so the keys reach them as they reach values.
 */
export type Row =
  | (SearchToken & { kind: 'value'; count: number })
  | { kind: 'field'; field: string; label: string; count: number }
  | { kind: 'back'; field: string; label: string };

/** A titled run of rows; an empty `label` sets its rows apart under a line instead. */
export interface Section {
  kind: 'section';
  label: string;
  items: Row[];
}

export function sameRow(left: Row, right: Row) {
  return (
    left.kind === right.kind &&
    left.field === right.field &&
    (left.kind !== 'value' || right.kind !== 'value' || left.value === right.value)
  );
}

export function rowKey(row: Row) {
  return row.kind === 'value' ? `${row.field}\n${row.value}` : `${row.kind}\n${row.field}`;
}

function valuesOf(group: TokenGroup): Row[] {
  return group.values.map(({ value, count }) => ({
    count,
    field: group.field,
    kind: 'value',
    value,
  }));
}

/** The opened field's values in its sections, each run of values in one section together. */
function sectionsOf(group: TokenGroup): Section[] {
  const sections: Section[] = [];
  for (const { value, count } of group.values) {
    const label = group.section?.(value) ?? '';
    const row: Row = { count, field: group.field, kind: 'value', value };
    const last = sections.at(-1);
    if (last?.label === label) {
      last.items.push(row);
    } else {
      sections.push({ items: [row], kind: 'section', label });
    }
  }
  return sections;
}

/**
 * What the list shows. With a field open, the way back and that field's values, in its sections
 * if it has them. With a query typed, every field's values, under their fields, for the list to
 * filter. Otherwise the fields to open, leaving out those with no values here, so with none
 * the list says why instead.
 */
export function listItems({
  groups,
  openGroup,
  query,
}: {
  groups: TokenGroup[];
  openGroup: TokenGroup | undefined;
  query: string;
}): Row[] | Section[] {
  if (openGroup) {
    const back: Row = { field: openGroup.field, kind: 'back', label: openGroup.label };
    // Base UI takes the list as all rows or all sections, so with sections the way back is one.
    return openGroup.section
      ? [{ items: [back], kind: 'section', label: '' }, ...sectionsOf(openGroup)]
      : [back, ...valuesOf(openGroup)];
  }
  if (query.trim()) {
    return groups
      .map((group): Section => ({ items: valuesOf(group), kind: 'section', label: group.label }))
      .filter((section) => section.items.length > 0);
  }
  return groups
    .filter((group) => group.values.length > 0)
    .map((group): Row => ({
      count: group.values.length,
      field: group.field,
      kind: 'field',
      label: group.label,
    }));
}
