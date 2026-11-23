import type { ReactNode } from 'react';

/** A keyboard shortcut: as people read it (`⇧⌘F`), and as `aria-keyshortcuts` writes it. */
export interface Shortcut {
  label: string;
  /** Such as `Meta+Shift+F`, which screen readers announce with the control it runs. */
  keys: string;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="text-label-tertiary font-sans text-xs">{children}</kbd>;
}
