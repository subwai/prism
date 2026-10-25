import { cn, tv } from '#cn';
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
  className
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

const floatingControls = tv({
  base: 'pointer-events-none absolute inset-x-0 flex justify-center opacity-0 transition-opacity *:pointer-events-auto group-focus-within:opacity-100 group-hover:opacity-100',
  variants: {
    position: { bottom: 'bottom-4', top: 'top-4' }
  }
});

/**
 * Centres a `FloatingToolbar` along the top or bottom of the media it floats over, kept out of
 * the way until the pointer or focus is inside the nearest `group`, such as the viewer.
 */
export function FloatingControls({
  position,
  children
}: {
  position: 'top' | 'bottom';
  children: ReactNode;
}) {
  return <div className={floatingControls({ position })}>{children}</div>;
}
