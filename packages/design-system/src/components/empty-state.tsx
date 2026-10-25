import { cn } from '#cn';
import type { ReactNode } from 'react';

/**
 * Centred message for a view with nothing to show: empty, still loading, or failed. It fills
 * its container; over media, place it with a class name such as `absolute inset-0`.
 */
export function EmptyState({
  icon,
  title,
  description,
  className,
}: {
  icon?: ReactNode;
  title?: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-20 flex-1 flex-col items-center justify-center gap-2.5 px-6 text-center text-label-quaternary',
        className,
      )}
    >
      {icon}
      {title && (
        <h2 className={cn('text-xl font-medium text-label-secondary', icon && 'mt-1.5')}>
          {title}
        </h2>
      )}
      <p className="text-label-tertiary text-base">{description}</p>
    </div>
  );
}
