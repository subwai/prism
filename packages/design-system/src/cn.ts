/** Joins class names, skipping falsy entries so conditions can be written inline. */
export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
