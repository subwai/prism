import type { ReactNode } from 'react';

/**
 * A label over the foot of a photo or video, on a scrim so it reads over any picture, such as
 * what kind of entry a card is. Its parent must be positioned and clip its corners.
 */
export function MediaCaption({ icon, children }: { icon: ReactNode; children?: ReactNode }) {
  return (
    <>
      <span className="to-scrim pointer-events-none absolute inset-0 bg-linear-to-b from-transparent from-55%" />
      <span className="text-on-media text-shadow-overlay icon-xs absolute bottom-1.75 left-1.75 z-1 flex items-center gap-1.25 text-xs">
        {icon}
        {children}
      </span>
    </>
  );
}
