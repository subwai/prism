import { cn } from '#cn';
import { IconButton } from '#components/button';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Inline warning across the top of a view, with optional actions, and a close button when it
 * can be dismissed. Polite rather than an alert: its text can update as a scan goes on, and
 * each update would interrupt.
 */
export function Banner({
  children,
  action,
  onDismiss,
}: {
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      className="bg-warning-fill text-warning flex shrink-0 items-center gap-2.5 px-5 py-2.25"
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onDismiss && (
        <IconButton label="Dismiss" onClick={onDismiss}>
          <X />
        </IconButton>
      )}
    </div>
  );
}

/**
 * Floating message above the status bar, not tied to one view: a warning by default, an alert
 * that interrupts, or with `tone="info"` news that waits its turn, such as what a check found.
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
