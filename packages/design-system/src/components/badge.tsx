import { cn } from '#cn';
import type { ReactNode } from 'react';

/** Small outlined uppercase tag, e.g. a location or scope. */
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'rounded-xs border border-separator px-1 py-0.5 text-3xs font-medium tracking-eyebrow text-label-tertiary uppercase',
        className,
      )}
    >
      {children}
    </span>
  );
}
