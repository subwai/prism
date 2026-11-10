import { cn } from '#cn';
import type { ComponentProps, ReactNode } from 'react';

/**
 * A row of a plain list: a one-line title over its detail, after an optional icon, divided from
 * the next. Its text can be selected to copy. A virtualized list places it with `style` and
 * measures it with `ref` and `data-index`.
 */
export function ListRow({
  icon,
  title,
  children,
  ref,
  style,
  className,
  'data-index': index,
}: Pick<ComponentProps<'li'>, 'ref' | 'style' | 'className'> & {
  icon?: ReactNode;
  /** One line, cut short; the whole of it shows on hover. */
  title: string;
  children?: ReactNode;
  'data-index'?: number;
}) {
  return (
    <li
      ref={ref}
      data-index={index}
      style={style}
      className={cn(
        'border-separator icon-sm flex gap-2.5 border-b px-5 py-2.5 select-text',
        className,
      )}
    >
      {icon && <span className="flex h-5 shrink-0 items-center">{icon}</span>}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium" title={title}>
          {title}
        </span>
        {children && <span className="text-label-secondary text-sm break-words">{children}</span>}
      </span>
    </li>
  );
}
