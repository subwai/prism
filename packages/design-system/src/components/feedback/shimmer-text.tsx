import type { ReactNode } from 'react';

/** A widely tracked, uppercase label with a tw-shimmer highlight sweeping across it. */
export function ShimmerText({ children }: { children: ReactNode }) {
  return (
    // Negative right margin cancels the tracking after the last letter so it centers optically.
    <span className="shimmer text-label-tertiary tracking-loading -mr-(--tracking-loading) text-2xl font-extralight uppercase select-none">
      {children}
    </span>
  );
}
