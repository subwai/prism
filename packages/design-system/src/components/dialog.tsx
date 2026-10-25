import { tv } from '#cn';
import { mergeRefs } from '#merge-refs';
import { type ReactNode, type Ref, useCallback, useMemo } from 'react';
import type { VariantProps } from 'tailwind-variants';

const dialog = tv({
  base: 'm-auto flex-col overflow-hidden p-0 text-inherit shadow-window backdrop:bg-scrim backdrop:backdrop-blur-sm open:flex',
  defaultVariants: { size: 'large', surface: 'solid' },
  variants: {
    // Floating sizes are framed; `full` covers the whole window edge to edge.
    size: {
      full: 'size-full max-h-none max-w-none',
      large: 'sheet-large rounded-window border border-edge',
      medium: 'sheet-medium rounded-window border border-edge',
      /** As tall as its contents, for a short form or question, with room around them. */
      small: 'w-90 gap-4 rounded-window border border-edge p-4',
    },
    surface: {
      /** Frosted glass: the blurred window shows through, as for a quick preview. */
      material: 'bg-surface/65 backdrop-blur-2xl backdrop-saturate-150',
      solid: 'bg-surface',
    },
  },
});

/**
 * Modal sheet over a blurred window. Escape calls `onClose` instead of closing directly.
 * Focus starts on the element marked `data-autofocus`, if any, and returns where it was.
 * It is named by the ID of its visible title, `labelledBy`, or by `label` if it has none.
 * A `small` one lays its children out in a padded column: a `DialogTitle`, the content, and a
 * `DialogFooter`; a form around them can pass its children through with `className="contents"`.
 */
export function Dialog({
  ref,
  children,
  label,
  labelledBy,
  describedBy,
  onClose,
  size,
  surface,
}: ({ label: string; labelledBy?: never } | { label?: never; labelledBy: string }) & {
  ref?: Ref<HTMLDialogElement>;
  children: ReactNode;
  /** The ID of a line that says more about it, such as what kind of preview it is. */
  describedBy?: string;
  onClose: () => void;
} & VariantProps<typeof dialog>) {
  // A ref callback, not an effect: its cleanup closes the dialog before React removes it, so
  // the browser can return focus. React's `autoFocus` runs before the dialog opens, when
  // nothing inside can take focus, hence the data attribute.
  const open = useCallback((element: HTMLDialogElement) => {
    element.showModal();
    element.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => element.close();
  }, []);
  const refs = useMemo(() => mergeRefs(open, ref), [open, ref]);
  return (
    <dialog
      ref={refs}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={dialog({ size, surface })}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

/** A small dialog's heading; give its `id` to the dialog's `labelledBy`. */
export function DialogTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-md truncate font-semibold">
      {children}
    </h2>
  );
}

/** A small dialog's buttons, at its foot and to the right, the main one last. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2">{children}</div>;
}
