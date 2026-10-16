import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description
}: {
  icon?: ReactNode;
  title?: string;
  description: string;
}) {
  return (
    <div className="flex min-h-20 flex-1 flex-col items-center justify-center gap-2.5 text-label-quaternary">
      {icon}
      {title && <h2 className="mt-1.5 text-title-3 font-medium text-label-secondary">{title}</h2>}
      <p className="text-body text-label-tertiary">{description}</p>
    </div>
  );
}
