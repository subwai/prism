import type { ReactNode } from 'react';

/** Inline warning across the top of a view, with an optional action. */
export function Banner({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-between gap-2.5 bg-warning-fill px-5 py-2.25 text-warning"
    >
      {children}
      {action}
    </div>
  );
}

/** Floating warning above the status bar, for errors not tied to one view. */
export function Toast({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="fixed bottom-13 left-1/2 z-10 -translate-x-1/2 rounded-card border border-warning-border bg-warning-surface px-5 py-2.25 text-warning shadow-toast backdrop-blur-xl"
    >
      {children}
    </div>
  );
}
