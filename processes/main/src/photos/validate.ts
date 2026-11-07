import type { ScanOptions } from '@prism/shared';
import path from 'node:path';

const MAX_ID_LENGTH = 32_768,
  // Folders a scan may leave out, such as those a window has listed already.
  MAX_EXCLUDED_FOLDERS = 64;

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

/** Checks scan options the window sent. */
export function requireScanOptions(options: unknown): asserts options is ScanOptions {
  if (!options || typeof options !== 'object' || !('directoryId' in options)) {
    throw new Error('Invalid scan options.');
  }
  requireString(options.directoryId);
  for (const flag of ['recursive', 'metadata', 'exif']) {
    if (flag in options && typeof (options as Record<string, unknown>)[flag] !== 'boolean') {
      throw new Error('Invalid scan options.');
    }
  }
  if ('excludeDirectoryIds' in options && options.excludeDirectoryIds !== undefined) {
    requireStrings(options.excludeDirectoryIds, MAX_EXCLUDED_FOLDERS);
  }
}

/** Whether `file` is `root` or inside it. */
export function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}
