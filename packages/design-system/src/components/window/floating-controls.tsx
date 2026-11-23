import { tv } from '#cn';
import type { ReactNode } from 'react';

const floatingControls = tv({
  base: 'pointer-events-none absolute inset-x-0 flex justify-center opacity-0 transition-opacity *:pointer-events-auto group-focus-within:opacity-100 group-hover:opacity-100 group-data-idle:opacity-0!',
  variants: {
    position: { bottom: 'bottom-4', top: 'top-4' },
  },
});

/**
 * Centres a `FloatingToolbar` along the top or bottom of the media it floats over, kept out of
 * the way until the pointer or focus is inside the nearest `group`, such as the viewer. While
 * that group is marked `data-idle`, it stays hidden even then.
 */
export function FloatingControls({
  position,
  children,
}: {
  position: 'top' | 'bottom';
  children: ReactNode;
}) {
  return <div className={floatingControls({ position })}>{children}</div>;
}
