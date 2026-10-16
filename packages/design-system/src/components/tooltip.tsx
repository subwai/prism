import { Kbd } from '#components/kbd';

declare module 'react' {
  // oxlint-disable-next-line id-length -- Must match React's declaration to merge with it.
  interface ButtonHTMLAttributes<T> {
    /** Interest invokers: hovering or focusing the button shows the popover with this id. */
    interestfor?: string;
  }
}

/**
 * Hint shown after a moment of hover or focus on the button whose `interestfor` names `id`:
 * what the control does and its keyboard shortcut. The browser handles timing and dismissal,
 * and anchors it to that button.
 */
export function Tooltip({ id, label, shortcut }: { id: string; label: string; shortcut?: string }) {
  return (
    <span
      id={id}
      popover="hint"
      className="material pointer-events-none inset-auto m-0 mt-1.5 items-center gap-2 rounded-control bg-menu/90 px-2 py-1 text-footnote whitespace-nowrap text-label [position-area:bottom] [position-try-fallbacks:flip-block] open:flex"
    >
      {label}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </span>
  );
}
