import { Spinner } from '#components/spinner';
import type { ReactNode } from 'react';

/** Status text led by a spinner while work is in progress, and a quiet dot once idle. */
export function StatusIndicator({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <span
      role="status"
      aria-busy={busy}
      className="text-label-secondary flex items-center gap-1.75 text-sm whitespace-nowrap"
    >
      {busy ? <Spinner size={11} /> : <span className="size-1.25 rounded-full bg-current" />}
      {children}
    </span>
  );
}
