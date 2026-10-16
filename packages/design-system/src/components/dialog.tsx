import { cn } from '#cn';
import { type ReactNode, useCallback } from 'react';

// Floating sizes are framed; `full` covers the whole window edge to edge.
const SIZES = {
  full: 'size-full max-h-none max-w-none',
  large: 'h-[90vh] max-h-[1100px] w-[92vw] max-w-[1500px] rounded-window border border-white/15',
  medium: 'h-[70vh] w-[72vw] rounded-window border border-white/15'
};

const SURFACES = {
  /** Frosted glass: the blurred window shows through, like a macOS sheet or Quick Look. */
  material: 'bg-surface/65 backdrop-blur-2xl backdrop-saturate-150',
  solid: 'bg-surface'
};

/**
 * Modal sheet over a blurred window. Escape calls `onClose` instead of closing directly.
 * Focus starts on the element marked `data-autofocus`, if any, and returns where it was.
 */
export function Dialog({
  children,
  label,
  onClose,
  size = 'large',
  surface = 'solid'
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  size?: keyof typeof SIZES;
  surface?: keyof typeof SURFACES;
}) {
  // A ref callback, not an effect: its cleanup closes the dialog before React removes it, so
  // the browser can return focus. React's `autoFocus` runs before the dialog opens, when
  // nothing inside can take focus, hence the data attribute.
  const ref = useCallback((dialog: HTMLDialogElement) => {
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={cn(
        'm-auto flex-col overflow-hidden p-0 text-inherit shadow-window backdrop:bg-black/60 backdrop:backdrop-blur-sm open:flex',
        SIZES[size],
        SURFACES[surface]
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
