import {
  MAX_VIEW_ROWS,
  type OpenedFolders,
  type Rating,
  RATING_FILTERS,
  RATINGS,
  SORT_ORDERS,
  VIEW_SHOWS,
  type ViewSpec,
} from '@prism/shared';
import path from 'node:path';
import {
  array,
  boolean,
  type GenericSchema,
  type InferOutput,
  maxLength,
  maxValue,
  minValue,
  nonEmpty,
  nullable,
  number,
  object,
  picklist,
  pipe,
  safeInteger,
  safeParse,
  string,
  tuple,
} from 'valibot';

const MAX_ID_LENGTH = 32_768,
  // Values a view's filter may choose of each field, and characters its search may hold.
  MAX_FILTER_VALUES = 256,
  MAX_SEARCH_LENGTH = 1024,
  // Folders the tree may remember opening or closing, more than any tree has on screen.
  MAX_OPENED_FOLDERS = 65_536,
  INVALID_VIEW = 'Invalid view.';

/** An ID or name the window sent, which may be anything. */
const ID = pipe(
  string('Expected a nonempty string.'),
  nonEmpty('Expected a nonempty string.'),
  maxLength(MAX_ID_LENGTH, 'Expected a nonempty string.'),
);

const FLAG = boolean(INVALID_VIEW);

/** The values a view's filter chooses of one field. */
const FILTER_VALUES = pipe(
  array(ID, INVALID_VIEW),
  maxLength(MAX_FILTER_VALUES, `Choose at most ${MAX_FILTER_VALUES} values to filter by.`),
);

/** A rating filter's values, such as `min3` for three stars or more. */
const RATING_VALUES = pipe(
  array(picklist(RATING_FILTERS, INVALID_VIEW), INVALID_VIEW),
  maxLength(RATING_FILTERS.length, INVALID_VIEW),
);

/** A rating the window gives an entry, or `null` to take it away. */
const RATING: GenericSchema<unknown, Rating | null> = nullable(
  picklist(RATINGS, 'Rate it from one to five stars.'),
);

/** What a view the window opens shows; typed as `ViewSpec`, so the two cannot drift apart. */
const VIEW_SPEC: GenericSchema<unknown, ViewSpec> = object(
  {
    descending: FLAG,
    directoryId: ID,
    filter: object(
      {
        camera: FILTER_VALUES,
        format: FILTER_VALUES,
        lens: FILTER_VALUES,
        rating: RATING_VALUES,
        tag: FILTER_VALUES,
      },
      INVALID_VIEW,
    ),
    recursive: FLAG,
    search: pipe(string(INVALID_VIEW), maxLength(MAX_SEARCH_LENGTH, INVALID_VIEW)),
    show: picklist(VIEW_SHOWS, INVALID_VIEW),
    sort: picklist(SORT_ORDERS, INVALID_VIEW),
    suggesting: FLAG,
  },
  INVALID_VIEW,
);

/** A folder the tree opened, `true`, or closed by hand. */
const OPENED_FOLDER = tuple([ID, boolean()]);

/** The folders the tree opened or closed by hand; typed as `OpenedFolders` too. */
const OPENED_FOLDERS: GenericSchema<unknown, OpenedFolders> = pipe(
  array(OPENED_FOLDER),
  maxLength(MAX_OPENED_FOLDERS, `Remember at most ${MAX_OPENED_FOLDERS} folders.`),
);

/** A version, or a place in a view's rows. */
const COUNT = pipe(number(INVALID_VIEW), safeInteger(INVALID_VIEW), minValue(0, INVALID_VIEW));

/** A range of a view's rows, of at most `MAX_VIEW_ROWS`. */
const VIEW_RANGE = tuple([
  COUNT,
  COUNT,
  pipe(COUNT, maxValue(MAX_VIEW_ROWS, `Ask for at most ${MAX_VIEW_ROWS} rows at a time.`)),
]);

/** Checks `value` against `schema`, throwing the first problem as a plain error. */
function check<Schema extends GenericSchema>(
  schema: Schema,
  value: unknown,
): asserts value is InferOutput<Schema> {
  const result = safeParse(schema, value);
  if (!result.success) {
    throw new Error(result.issues[0].message);
  }
}

/** Checks an ID or name the window sent, which may be anything. */
export function requireString(value: unknown): asserts value is string {
  check(ID, value);
}

/** Whether `value`, say as a file kept it, is an ID or name. */
export function isString(value: unknown): value is string {
  return safeParse(ID, value).success;
}

/** Whether `file` is `root` or inside it. */
export function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

/** Checks what a view the window opens shows. */
export function requireViewSpec(spec: unknown): asserts spec is ViewSpec {
  check(VIEW_SPEC, spec);
}

/** Checks a rating the window gives an entry: one to five stars, or `null` for none. */
export function requireRating(value: unknown): asserts value is Rating | null {
  check(RATING, value);
}

/** Checks the folders the tree opened or closed by hand, as the window sent or a file kept them. */
export function requireOpenedFolders(value: unknown): asserts value is OpenedFolders {
  check(OPENED_FOLDERS, value);
}

/** Whether `value`, say as a file kept it, is the folders the tree opened or closed by hand. */
export function isOpenedFolders(value: unknown): value is OpenedFolders {
  return safeParse(OPENED_FOLDERS, value).success;
}

/** Checks a range of a view's rows the window asks for, of at most `MAX_VIEW_ROWS`. */
export function requireViewRange(version: unknown, start: unknown, count: unknown): void {
  check(VIEW_RANGE, [version, start, count]);
}
