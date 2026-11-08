import { FILTER_FIELDS, MAX_VIEW_ROWS, type ViewSpec } from '@prism/shared';
import path from 'node:path';

const MAX_ID_LENGTH = 32_768,
  // Values a view's filter may choose of each field, and characters its search may hold.
  MAX_FILTER_VALUES = 256,
  MAX_SEARCH_LENGTH = 1024,
  SHOWS = new Set<string>(['all', 'media', 'images'] satisfies ViewSpec['show'][]),
  SORTS = new Set<string>([
    'name',
    'taken',
    'modified',
    'created',
    'size',
  ] satisfies ViewSpec['sort'][]);

/** Checks an ID or name the window sent, which may be anything. */
export function requireString(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new Error('Expected a nonempty string.');
  }
}

/** Checks a list of IDs the window sent, of at most `max`. */
export function requireStrings(value: unknown, max: number): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error(`Expected a list of at most ${max} strings.`);
  }
  for (const item of value) {
    requireString(item);
  }
}

/** Whether `error` says a file or folder does not exist. */
export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Whether `file` is `root` or inside it. */
export function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function invalidView(): never {
  throw new Error('Invalid view.');
}

/** Checks what a view the window opens shows. */
export function requireViewSpec(spec: unknown): asserts spec is ViewSpec {
  if (!spec || typeof spec !== 'object') {
    invalidView();
  }
  const value = spec as Record<string, unknown>;
  requireString(value.directoryId);
  for (const flag of ['recursive', 'descending', 'suggesting']) {
    if (typeof value[flag] !== 'boolean') {
      invalidView();
    }
  }
  if (
    !SHOWS.has(String(value.show)) ||
    !SORTS.has(String(value.sort)) ||
    typeof value.search !== 'string' ||
    value.search.length > MAX_SEARCH_LENGTH ||
    !value.filter ||
    typeof value.filter !== 'object'
  ) {
    invalidView();
  }
  const filter = value.filter as Record<string, unknown>;
  for (const field of FILTER_FIELDS) {
    requireStrings(filter[field], MAX_FILTER_VALUES);
  }
}

/** Checks a range of a view's rows the window asks for, of at most `MAX_VIEW_ROWS`. */
export function requireViewRange(version: unknown, start: unknown, count: unknown): void {
  for (const value of [version, start, count]) {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      invalidView();
    }
  }
  if ((count as number) > MAX_VIEW_ROWS) {
    throw new Error(`Ask for at most ${MAX_VIEW_ROWS} rows at a time.`);
  }
}
