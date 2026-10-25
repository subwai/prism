import { cn } from '#cn';
import { IconButton } from '#components/button';
import { Dialog } from '#components/dialog';
import type { Shortcut } from '#components/kbd';
import { X } from 'lucide-react';
import { type ComponentProps, type ReactNode, type Ref, useId } from 'react';

/**
 * Sheet for peeking at something without leaving the view: a frosted modal with a titled
 * header, which names it, and a caption, which describes it. Escape closes it; the app may
 * close it with the key that opened it.
 */
export function PreviewSheet({
  ref,
  title,
  caption,
  leading,
  actions,
  onClose,
  closeShortcut,
  size,
  children
}: {
  /** The sheet's dialog element, such as to handle commands from anywhere in it. */
  ref?: Ref<HTMLDialogElement>;
  title: ReactNode;
  /** Small uppercase line under the title, such as what kind of preview this is. */
  caption?: ReactNode;
  /** Controls before the title, such as going up a level. */
  leading?: ReactNode;
  /** Controls between the title and the close button. */
  actions?: ReactNode;
  onClose: () => void;
  /** The key that closes it besides Escape. */
  closeShortcut?: Shortcut;
  size: ComponentProps<typeof Dialog>['size'];
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Dialog
      ref={ref}
      labelledBy={`${id}-title`}
      describedBy={caption ? `${id}-caption` : undefined}
      onClose={onClose}
      size={size}
      surface="material"
    >
      <div className="contents">
        <header className="border-separator flex h-14 shrink-0 items-center gap-3 border-b px-3.5">
          {leading}
          <div className={cn('flex min-w-0 flex-1 flex-col gap-0.75', !leading && 'pl-1')}>
            <strong id={`${id}-title`} className="truncate text-lg font-semibold">
              {title}
            </strong>
            {caption && (
              <span id={`${id}-caption`} className="eyebrow">
                {caption}
              </span>
            )}
          </div>
          {actions}
          <IconButton label="Close preview" shortcut={closeShortcut} onClick={onClose}>
            <X />
          </IconButton>
        </header>
        {children}
      </div>
    </Dialog>
  );
}
