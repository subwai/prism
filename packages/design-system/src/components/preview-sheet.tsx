import { cn } from '#cn';
import { IconButton } from '#components/button';
import { Dialog } from '#components/dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Quick Look style sheet for peeking at something without leaving the view: a frosted modal
 * with a titled header. Escape closes it; the app may close it with the key that opened it.
 */
export function PreviewSheet({
  label,
  title,
  caption,
  leading,
  actions,
  onClose,
  closeShortcut,
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
  /** The key that closes it besides Escape, as the platform writes it, for the tooltip. */
  closeShortcut?: string;
  size: ComponentProps<typeof Dialog>['size'];
  children: ReactNode;
}) {
  return (
    <Dialog label={label} onClose={onClose} size={size} surface="material">
      <div className="contents">
        <header className="border-separator flex h-14 shrink-0 items-center gap-3 border-b px-3.5">
          {leading}
          <div className={cn('flex min-w-0 flex-1 flex-col gap-0.75', !leading && 'pl-1')}>
            <strong className="text-callout truncate font-semibold">{title}</strong>
            {caption && (
              <span className="text-micro text-label-tertiary tracking-widest uppercase">
                {caption}
              </span>
            )}
          </div>
          {actions}
          <IconButton label="Close preview" shortcut={closeShortcut} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </div>
    </Dialog>
  );
}
