import path from 'node:path';

const MAX_ID_LENGTH = 32_768;

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
