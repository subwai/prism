import type { ReactNode } from 'react';

/**
 * Text only screen readers get, read out each time it changes while `active`, and kept quiet
 * otherwise, such as while a slideshow would talk over everything. Its first text is not read:
 * render it from the start, and change what it says.
 */
export function LiveRegion({ active = true, children }: { active?: boolean; children: ReactNode }) {
  return (
    <p className="sr-only" aria-live={active ? 'polite' : 'off'} aria-atomic>
      {children}
    </p>
  );
}
