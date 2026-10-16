import { cn } from '#cn';
import type { ReactNode } from 'react';

/** Translucent pill of controls that floats over media, like Quick Look's controls. */
export function FloatingToolbar({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-full material bg-hud/80 px-1.5 py-1 text-footnote text-label-secondary',
        className
      )}
    >
      {children}
    </div>
  );
}

export function FloatingToolbarDivider() {
  return <span className="bg-separator mx-1 h-4 w-px" />;
}
