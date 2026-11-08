import type { PhotoEntry } from '@prism/shared';

/** Entry kinds as the catalog stores them; folders are 0, so they come first. */
export const KIND_CODES: Record<PhotoEntry['kind'], number> = {
  directory: 0,
  file: 3,
  image: 1,
  video: 2,
};
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
