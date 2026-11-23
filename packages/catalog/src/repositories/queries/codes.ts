import type { PhotoEntry } from '@prism/shared';
import path from 'node:path';

/** Entry kinds as the catalog stores them; folders are 0, so they come first. */
export const KIND_CODES: Record<PhotoEntry['kind'], number> = {
  directory: 0,
  file: 3,
  image: 1,
  video: 2,
};

/**
 * How far a photo's `exif_read` says its details got: still to read, read, or tried and found
 * unreadable, as when the file cannot be opened. Read and unreadable both hold only while the
 * file keeps the size and modification time they were found at.
 */
export const DETAILS_CODES = { read: 1, unread: 0, unreadable: 2 } as const;
const KINDS: PhotoEntry['kind'][] = ['directory', 'image', 'video', 'file'];

/** The kind the catalog stores as `code`. */
export function kindOf(code: number): PhotoEntry['kind'] {
  return KINDS[code] ?? 'file';
}

/** Digit runs longer than this many digits sort by their digits rather than their value. */
const MAX_NUMBER_DIGITS = 99;

/**
 * A key that sorts names as `Intl.Collator` with `numeric` and `base` sensitivity does, closely
 * enough, by plain comparison: case and accents folded, and each run of digits led by its
 * length, so "IMG_9" comes before "IMG_10". `node:sqlite` cannot register a collation, so the
 * catalog stores this instead.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replaceAll(/\d+/gu, (digits) => {
      const value = digits.replace(/^0+(?=\d)/u, '');
      const length = Math.min(value.length, MAX_NUMBER_DIGITS);
      return `${String(length).padStart(2, '0')}${value}`;
    });
}

/** What a search matches a name against: the name as `toLocaleLowerCase` gives it. */
export function nameFold(name: string): string {
  return name.toLocaleLowerCase();
}

/** What joins a folder's names in `parentKey`: below any character `nameKey` gives a name. */
const KEY_SEPARATOR = '\u0001';

/**
 * A key that sorts entries by the folder at `parentId`, as `nameKey` sorts names: each of its
 * names' keys, joined by a character that comes first, so "a/b" comes before "a b" and after
 * "a". The library's own folder is empty, so its entries come before every other folder's.
 */
export function parentKey(parentId: string): string {
  if (parentId === '.') {
    return '';
  }
  return parentId
    .split(path.sep)
    .map((name) => nameKey(name))
    .join(KEY_SEPARATOR);
}
