import { cn } from '#cn';
import type { ReactNode } from 'react';

/**
 * Translucent pill of controls that floats over media. `label` names the group for screen
 * readers, such as "Video controls". The controls at its ends are rounded on their outer side,
 * so their hover and pressed fills follow the pill instead of poking square corners into it.
 * Content collapsed out of the way at an end should be `inert`, so the control before it
 * counts as the end.
 */
export function FloatingToolbar({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex items-center gap-0.5 rounded-full material bg-hud/80 px-1.5 py-1 text-sm text-label-secondary edge-start:rounded-s-pill-end edge-end:rounded-e-pill-end',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FloatingToolbarDivider() {
  return <span className="bg-separator mx-1 h-4 w-px" />;
}
