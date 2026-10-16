import type { ReactNode } from 'react';

/** Inline warning across the top of a view, with an optional action. */
export function Banner({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="bg-warning-fill text-warning flex shrink-0 items-center justify-between gap-2.5 px-5 py-2.25"
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
      className="rounded-card border-warning-border bg-warning-surface text-warning shadow-toast fixed bottom-13 left-1/2 z-10 -translate-x-1/2 border px-5 py-2.25 backdrop-blur-xl"
    >
      {children}
    </div>
  );
}
