import { IconButton } from '#components/buttons/button';
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
