import { cn } from '#cn';
import { IconButton } from '#components/button';
import { Dialog } from '#components/dialog';
import { X } from 'lucide-react';
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';

/**
 * Quick Look style sheet for peeking at something without leaving the view: a frosted modal
 * with a titled header. Space closes it, as Space opened it; buttons keep Space for pressing
 * them, and anything inside that handles Space itself takes precedence.
 */
export function PreviewSheet({
  label,
  title,
  caption,
  leading,
  actions,
  onClose,
  size,
  children
}: {
  /** Accessible name of the dialog. */
  label: string;
  title: ReactNode;
  /** Small uppercase line under the title, such as what kind of preview this is. */
  caption?: ReactNode;
  /** Controls before the title, such as going up a level. */
  leading?: ReactNode;
  /** Controls between the title and the close button. */
  actions?: ReactNode;
  onClose: () => void;
  size: ComponentProps<typeof Dialog>['size'];
  children: ReactNode;
}) {
  function closeOnSpace(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      event.key === ' ' &&
      !event.shiftKey &&
      !event.defaultPrevented &&
      !target.closest('button, input')
    ) {
      event.preventDefault();
      onClose();
    }
  }
  return (
    <Dialog label={label} onClose={onClose} size={size} surface="material">
      <div className="contents" onKeyDown={closeOnSpace}>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-separator px-3.5">
          {leading}
          <div className={cn('flex min-w-0 flex-1 flex-col gap-0.75', !leading && 'pl-1')}>
            <strong className="truncate text-callout font-semibold">{title}</strong>
            {caption && (
              <span className="text-micro tracking-widest text-label-tertiary uppercase">
                {caption}
              </span>
            )}
          </div>
          {actions}
          <IconButton label="Close preview" shortcut="Space" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </div>
    </Dialog>
  );
}
