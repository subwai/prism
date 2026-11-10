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
export function loose(text: string) {
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

export interface Section {
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

export function valuesOf(group: TokenGroup): Row[] {
  return group.values.map(({ value, count }) => ({
    count,
    field: group.field,
    kind: 'value',
    value,
  }));
}

/** The opened field's values in its sections, each run of values in one section together. */
export function sectionsOf(group: TokenGroup): Section[] {
  const sections: Section[] = [];
  for (const { value, count } of group.values) {
    const label = group.section?.(value) ?? '';
    const row: Row = { count, field: group.field, kind: 'value', value };
    const last = sections.at(-1);
    if (last?.label === label) {
      last.items.push(row);
    } else {
      sections.push({ items: [row], label });
    }
  }
  return sections;
}
