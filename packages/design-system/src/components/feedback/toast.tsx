import { cn } from '#cn';
import type { ReactNode } from 'react';

/**
 * Floating message above the status bar, not tied to one view. By default it is a warning,
 * which screen readers announce at once. With `tone="info"` it is a notice, such as what a
 * check found, which they read once they have finished what they are saying.
 */
export function Toast({
  children,
  tone = 'warning',
}: {
  children: ReactNode;
  tone?: 'warning' | 'info';
}) {
  return (
    <div
      role={tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'rounded-card shadow-toast fixed bottom-13 left-1/2 z-10 -translate-x-1/2 border px-5 py-2.25 backdrop-blur-xl transition-opacity starting:opacity-0',
        tone === 'warning'
          ? 'border-warning-border bg-warning-surface text-warning'
          : 'border-edge-subtle bg-menu/90 text-label',
      )}
    >
      {children}
    </div>
  );
}
