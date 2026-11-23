import { and, type Column, inArray, sql, type SQL } from 'drizzle-orm';

/**
 * Small SQL pieces that every repository uses, whatever table it queries: conditions, upserts
 * and the JSON arrays SQLite gathers numbers into.
 */

/**
 * Combines `conditions` so a row must match all of them. Drizzle's `and` would do, but its type
 * says it may return nothing.
 */
export function matchAll(...conditions: SQL[]): SQL {
  return and(...conditions) ?? sql`1`;
}

/**
 * Whether `column` is one of `list`, which goes as one JSON parameter however long it is,
 * where SQLite allows a few thousand, and with one statement text whatever its length.
 */
export function isIn(column: Column, list: readonly (number | string)[]): SQL {
  return inArray(column, sql`(SELECT value FROM json_each(${JSON.stringify(list)}))`);
}

/** Numbers SQLite gathered with `json_group_array`, which is far quicker than a row each. */
export function parseNumbers(json: string | null | undefined): number[] {
  return JSON.parse(json ?? '[]') as number[];
}

/** The value an upsert tried to write to `column`, in its `ON CONFLICT DO UPDATE`. */
export function excluded(column: Column): SQL {
  return sql.raw(`excluded.${column.name}`);
}
